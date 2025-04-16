import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { getSecret, getCsrfSecret, clearSecretsCache, setMockSecretsClient, resetSecretsClient } from "../src/utils/secrets.ts";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

describe("Secrets Utility", () => {
  const originalEnv = { ...process.env };
  
  // Create a mock client with configurable response
  const mockClient = {
    send: mock(async (command) => {
      return {
        SecretString: ""
      };
    })
  };
  
  beforeEach(() => {
    // Reset the environment variables
    process.env = { ...originalEnv };
    
    // Set the mock client
    setMockSecretsClient(mockClient);
    
    // Clear the mocks
    mock.restore();
    
    // Clear the secrets cache before each test
    clearSecretsCache();
  });
  
  afterEach(() => {
    // Restore the original environment variables
    process.env = originalEnv;
    
    // Reset the client
    resetSecretsClient();
  });
  
  describe("getSecret", () => {
    it("should use environment variables in non-production environments", async () => {
      // Arrange
      process.env.NODE_ENV = "development";
      process.env.TEST_SECRET_KEY = "test-secret-value";
      
      // Act
      const result = await getSecret("TestSecret", "TEST_SECRET_KEY");
      
      // Assert
      expect(result).toBe("test-secret-value");
      // Ensure we didn't call the AWS SDK
      expect(mockClient.send).not.toHaveBeenCalled();
    });
    
    it("should use default value if environment variable is not set in non-production", async () => {
      // Arrange
      process.env.NODE_ENV = "development";
      delete process.env.TEST_SECRET_KEY;
      
      // Act
      const result = await getSecret("TestSecret", "TEST_SECRET_KEY");
      
      // Assert
      expect(result).toBe("local-development-secret");
      // Ensure we didn't call the AWS SDK
      expect(mockClient.send).not.toHaveBeenCalled();
    });
    
    it("should fetch from AWS Secrets Manager in production", async () => {
      // Arrange
      process.env.NODE_ENV = "production";
      
      mockClient.send = mock(async (command) => {
        return {
          SecretString: JSON.stringify({ TEST_KEY: "test-secret-from-aws" })
        };
      });
      // Act
      const result = await getSecret("TestSecret", "TEST_KEY");
      
      // Assert
      expect(result).toBe("test-secret-from-aws");
      expect(mockClient.send).toHaveBeenCalled();
    });
    
    it("should retrieve entire secret string if no key is specified", async () => {
      // Arrange
      process.env.NODE_ENV = "production";
      
      mockClient.send = mock(async (command) => {
        return {
          SecretString: "complete-secret-string"
        };
      });
      
      // Act
      const result = await getSecret("TestSecret");
      
      // Assert
      expect(result).toBe("complete-secret-string");
      expect(mockClient.send).toHaveBeenCalled();
    });
    
    it("should cache secret values", async () => {
      // Arrange
      process.env.NODE_ENV = "production";
      let callCount = 0;
      
      mockClient.send = mock(async (command) => {
        callCount++;
        return { 
          SecretString: JSON.stringify({ TEST_KEY: "test-secret-from-aws" })
        };
      });
      
      // Act
      const result1 = await getSecret("TestSecret", "TEST_KEY");
      const result2 = await getSecret("TestSecret", "TEST_KEY");
      
      // Assert
      expect(result1).toBe("test-secret-from-aws");
      expect(result2).toBe("test-secret-from-aws");
      // Should only call the AWS SDK once due to caching
      expect(callCount).toBe(1);
    });
    
    it("should fall back to environment variable if AWS call fails", async () => {
      // Arrange
      process.env.NODE_ENV = "production";
      process.env.TEST_FALLBACK_KEY = "fallback-value";
      
      mockClient.send = mock(async (command) => {
        throw new Error("AWS error");
      });
      
      // Act
      const result = await getSecret("TestSecret", "TEST_FALLBACK_KEY");
      
      // Assert
      expect(result).toBe("fallback-value");
      expect(mockClient.send).toHaveBeenCalled();
    });
    
    it("should throw an error if AWS call fails and no fallback is available", async () => {
      // Arrange
      process.env.NODE_ENV = "production";
      delete process.env.TEST_ERROR_KEY;
      
      mockClient.send = mock(() => {
        throw new Error("AWS error");
      });
      
      // Act & Assert
      await expect(getSecret("TestSecret", "TEST_ERROR_KEY")).rejects.toThrow("Failed to retrieve secret");
    });
  });
  
  describe("getCsrfSecret", () => {
    it("should retrieve the CSRF secret from AWS Secrets Manager", async () => {
      // Arrange
      process.env.NODE_ENV = "production";
      
      mockClient.send = mock(async (command) => {
        return {
          SecretString: JSON.stringify({ CSRF_SECRET: "csrf-secret-value" })
        };
      });
      
      // Act
      const result = await getCsrfSecret();
      
      // Assert
      expect(result).toBe("csrf-secret-value");
      expect(mockClient.send).toHaveBeenCalled();
    });
    
    it("should fall back to environment variable if AWS call fails", async () => {
      // Arrange
      process.env.NODE_ENV = "production";
      process.env.CSRF_SECRET = "env-csrf-secret";
      
      mockClient.send = mock(() => {
        throw new Error("AWS error");
      });
      
      // Act
      const result = await getCsrfSecret();
      
      // Assert
      expect(result).toBe("env-csrf-secret");
    });
    
    it("should use default value if AWS call fails and no environment variable is set", async () => {
      // Arrange
      process.env.NODE_ENV = "production";
      delete process.env.CSRF_SECRET;
      
      mockClient.send = mock(() => {
        throw new Error("AWS error");
      });
      
      // Act
      const result = await getCsrfSecret();
      
      // Assert
      expect(result).toBe("default-csrf-secret");
    });
  });
  
  describe("clearSecretsCache", () => {
    it("should clear the cache, causing a fresh fetch on next call", async () => {
      // Arrange
      process.env.NODE_ENV = "production";
      let callCount = 0;
      
      mockClient.send = mock(async (command) => {
        callCount++;
        if (callCount === 1) {
          return {
            SecretString: JSON.stringify({ TEST_KEY: "first-value" })
          };
        } else {
          return {
            SecretString: JSON.stringify({ TEST_KEY: "second-value" })
          };
        }
      });
      
      // Act - first call should cache
      const result1 = await getSecret("TestSecret", "TEST_KEY");
      // Clear the cache
      clearSecretsCache();
      // Second call should fetch fresh
      const result2 = await getSecret("TestSecret", "TEST_KEY");
      
      // Assert
      expect(result1).toBe("first-value");
      expect(result2).toBe("second-value");
      expect(callCount).toBe(2);
    });
  });
});