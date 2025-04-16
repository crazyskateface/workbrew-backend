import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import * as authChallengeService from "../src/services/authChallengeService.js";
import * as secretsUtil from "../src/utils/secrets.js";
import { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";

// Mock dependencies
const mockSend = mock(() => {});
const mockClient = {
  send: mockSend
};

const mockDynamoDB = {
  DynamoDBClient: mock(() => mockClient),
  PutItemCommand: mock(() => {}),
  GetItemCommand: mock(() => {}),
  DeleteItemCommand: mock(() => {})
};

const mockSecretsUtil = {
  getCsrfSecret: mock(() => {}),
  clearSecretsCache: mock(() => {})
};

// Set up mocks
mock.module("@aws-sdk/client-dynamodb", () => mockDynamoDB);
mock.module("../src/utils/secrets.js", () => mockSecretsUtil);

describe("Auth Challenge Service with Secrets Integration", () => {
  const originalEnv = { ...process.env };
  let mockDynamoClient: any;
  
  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    process.env.CHALLENGE_TABLE = "test-challenges-table";
    process.env.NODE_ENV = "test"; // Ensure we're in test mode
    
    // Get a reference to the mocked client
    mockDynamoClient = new DynamoDBClient({});
    
    // Reset mocks
    mockSend.mockReset();
    mockSecretsUtil.getCsrfSecret.mockReset();
    mockSecretsUtil.clearSecretsCache.mockReset();
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  describe("validateCsrfToken", () => {
    it("should fetch CSRF secret from Secrets Manager when validating a token", async () => {
      // Arrange
      const testSecret = "test-csrf-secret";
      const sessionToken = "session-token-123";
      const csrfToken = "valid-csrf-token";
      
      // Set the test secret directly (this is crucial for test stability)
      authChallengeService._setTestCsrfSecret(testSecret);
      
      // Mock the secrets utility to return our test secret
      mockSecretsUtil.getCsrfSecret.mockImplementation(async () => testSecret);
      
      // Create a spy on the hashPassword function to return a predictable value
      const hashSpy = spyOn(authChallengeService, "hashPassword");
      hashSpy.mockImplementation(() => {
        // Return a value that would match exactly the first 32 chars
        return csrfToken;
      });
      
      // Act
      const result = await authChallengeService.validateCsrfToken(csrfToken, sessionToken);
      
      // Assert
      expect(mockSecretsUtil.getCsrfSecret).toHaveBeenCalled();
      expect(hashSpy).toHaveBeenCalledWith(sessionToken, testSecret);
      expect(result).toBe(true);
    });
    
    it("should return false for invalid tokens", async () => {
      // Arrange
      const testSecret = "test-csrf-secret";
      const sessionToken = "session-token-123";
      const invalidCsrfToken = "invalid-token";
      const validHash = "valid-hash-different-from-input";
      
      // Set the test secret directly
      authChallengeService._setTestCsrfSecret(testSecret);
      
      // Mock the secrets utility
      mockSecretsUtil.getCsrfSecret.mockImplementation(async () => testSecret);
      
      // Mock the hash function to return a hash that won't match our token
      const hashSpy = spyOn(authChallengeService, "hashPassword");
      hashSpy.mockImplementation(() => validHash);
      
      // Act
      const result = await authChallengeService.validateCsrfToken(invalidCsrfToken, sessionToken);
      
      // Assert
      expect(mockSecretsUtil.getCsrfSecret).toHaveBeenCalled();
      expect(hashSpy).toHaveBeenCalledWith(sessionToken, testSecret);
      expect(result).toBe(false);
    });
    
    it("should handle errors in secret retrieval gracefully", async () => {
      // Arrange
      const fallbackSecret = "default-csrf-secret";
      const sessionToken = "session-token-123";
      const csrfToken = "valid-csrf-token";
      
      // Set up environment variable fallback
      process.env.CSRF_SECRET = fallbackSecret;
      
      // Directly set the test secret in our service to ensure consistent state
      authChallengeService._setTestCsrfSecret(fallbackSecret);
      
      // Mock the secrets utility to throw an error
      mockSecretsUtil.getCsrfSecret.mockImplementation(async () => {
        throw new Error("Secrets Manager error");
      });
      
      // Set up the hash function to return a matching value 
      const hashSpy = spyOn(authChallengeService, "hashPassword");
      hashSpy.mockImplementation(() => {
        return csrfToken; // Return exact matching value
      });
      
      // Act
      const result = await authChallengeService.validateCsrfToken(csrfToken, sessionToken);
      
      // Assert
      expect(mockSecretsUtil.getCsrfSecret).toHaveBeenCalled();
      expect(hashSpy).toHaveBeenCalledWith(sessionToken, fallbackSecret);
      expect(result).toBe(true);
    });
    
    it("should handle validation errors gracefully", async () => {
      // Arrange
      const sessionToken = "session-token-123";
      const csrfToken = "some-token";
      
      // Set the test secret directly to a known value
      authChallengeService._setTestCsrfSecret("test-secret");
      
      // Mock the secrets utility
      mockSecretsUtil.getCsrfSecret.mockImplementation(async () => "test-secret");
      
      // Make the hash function throw an error
      const hashSpy = spyOn(authChallengeService, "hashPassword");
      hashSpy.mockImplementation(() => {
        throw new Error("Hashing error");
      });
      
      // Act
      const result = await authChallengeService.validateCsrfToken(csrfToken, sessionToken);
      
      // Assert
      expect(result).toBe(false);
    });
  });
});