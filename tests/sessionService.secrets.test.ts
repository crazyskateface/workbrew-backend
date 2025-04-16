import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import * as sessionService from "../src/services/sessionService.js";
import * as secretsUtil from "../src/utils/secrets.js";
import * as dynamodb from "../src/utils/dynamodb.js";
import * as authChallengeService from "../src/services/authChallengeService.js";

// Mock dependencies
const mockDynamoDB = {
  putItem: mock(() => {}),
  getItem: mock(() => {}),
  updateItem: mock(() => {}),
  queryItems: mock(() => {}),
  scanItems: mock(() => {}),
  deleteItem: mock(() => {})
};

const mockSecretsUtil = {
  getCsrfSecret: mock(() => {}),
  clearSecretsCache: mock(() => {})
};

const mockAuthChallengeService = {
  hashPassword: mock(() => {})
};

// Set up mocks
mock.module("../src/utils/dynamodb.js", () => mockDynamoDB);
mock.module("../src/utils/secrets.js", () => mockSecretsUtil);
mock.module("../src/services/authChallengeService.js", () => mockAuthChallengeService);

describe("Session Service with Secrets Integration", () => {
  const originalEnv = { ...process.env };
  
  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    process.env.SESSION_TABLE = "test-sessions-table";
    
    // Reset mocks
    mock.restore();
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  describe("createSession", () => {
    it("should fetch CSRF secret from Secrets Manager when creating a session", async () => {
      // Arrange
      const testSecret = "test-csrf-secret";
      const testHash = "hashed-csrf-token";
      const userId = "user123";
      const username = "testuser";
      const sessionId = "session123"; // Will be generated with uuidv4 in real code
      
      // Mock UUID generation to return predictable value
      const mockUUID = {
        v4: mock(() => sessionId)
      };
      mock.module("uuid", () => mockUUID);
      
      // Mock the secrets utility to return our test secret
      mockSecretsUtil.getCsrfSecret.mockImplementation(async () => testSecret);
      
      // Mock the hash function to return a predictable value
      mockAuthChallengeService.hashPassword.mockImplementation(() => testHash);
      
      // Act
      const session = await sessionService.createSession(userId, username);
      
      // Assert
      expect(mockSecretsUtil.getCsrfSecret).toHaveBeenCalled();
      expect(mockAuthChallengeService.hashPassword).toHaveBeenCalledWith(
        expect.stringContaining(sessionId), // The input contains the sessionId
        testSecret // The secret should be passed to the hash function
      );
      expect(session.csrfToken).toBe(testHash.substring(0, 32));
      expect(mockDynamoDB.putItem).toHaveBeenCalledWith(
        "test-sessions-table", 
        expect.objectContaining({
          sessionId,
          userId,
          username,
          csrfToken: testHash.substring(0, 32)
        })
      );
    });
    
    it("should handle errors in secret retrieval gracefully", async () => {
      // Arrange
      const fallbackSecret = "default-csrf-secret";
      const testHash = "fallback-hashed-token";
      const userId = "user123";
      const username = "testuser";
      
      // Set up environment variable fallback
      process.env.CSRF_SECRET = fallbackSecret;
      
      // Mock the secrets utility to throw an error
      mockSecretsUtil.getCsrfSecret.mockImplementation(async () => {
        throw new Error("Secrets Manager error");
      });
      
      // Mock the hash function
      mockAuthChallengeService.hashPassword.mockImplementation(() => testHash);
      
      // Act
      const session = await sessionService.createSession(userId, username);
      
      // Assert
      expect(mockSecretsUtil.getCsrfSecret).toHaveBeenCalled();
      expect(mockAuthChallengeService.hashPassword).toHaveBeenCalledWith(
        expect.any(String),
        fallbackSecret // Should fall back to the environment variable
      );
      expect(session.csrfToken).toBe(testHash.substring(0, 32));
    });
  });
  
  describe("rotateCsrfToken", () => {
    it("should fetch fresh secret from Secrets Manager when rotating CSRF token", async () => {
      // Arrange
      const sessionId = "session123";
      const testSecret = "fresh-csrf-secret";
      const testHash = "fresh-hashed-token";
      const mockSession = {
        sessionId,
        userId: "user123",
        username: "testuser",
        csrfToken: "old-token",
        issuedAt: Date.now() - 60000, // 1 minute ago
        expiresAt: Date.now() + 3600000, // 1 hour from now
        lastRotatedAt: Date.now() - 900000, // 15 minutes ago
        lastActivityAt: Date.now(),
        isValid: true
      };
      
      // Mock getting the session
      mockDynamoDB.getItem.mockImplementation(async () => mockSession);
      
      // Mock the secrets utility
      mockSecretsUtil.getCsrfSecret.mockImplementation(async () => testSecret);
      
      // Mock the hash function
      mockAuthChallengeService.hashPassword.mockImplementation(() => testHash);
      
      // Act
      const newToken = await sessionService.rotateCsrfToken(sessionId);
      
      // Assert
      expect(mockSecretsUtil.getCsrfSecret).toHaveBeenCalled();
      expect(mockAuthChallengeService.hashPassword).toHaveBeenCalledWith(
        expect.stringContaining(sessionId),
        testSecret
      );
      expect(newToken).toBe(testHash.substring(0, 32));
      expect(mockDynamoDB.updateItem).toHaveBeenCalledWith(
        "test-sessions-table",
        { sessionId },
        "SET csrfToken = :csrfToken, lastRotatedAt = :lastRotatedAt",
        {},
        expect.objectContaining({
          ":csrfToken": testHash.substring(0, 32)
        })
      );
    });
    
    it("should handle secret retrieval errors during token rotation", async () => {
      // Arrange
      const sessionId = "session123";
      const fallbackSecret = "fallback-secret";
      const testHash = "fallback-hashed-token";
      const mockSession = {
        sessionId,
        userId: "user123",
        username: "testuser",
        csrfToken: "old-token",
        issuedAt: Date.now() - 60000, // 1 minute ago
        expiresAt: Date.now() + 3600000, // 1 hour from now
        lastRotatedAt: Date.now() - 900000, // 15 minutes ago
        lastActivityAt: Date.now(),
        isValid: true
      };
      
      // Set up environment variable fallback
      process.env.CSRF_SECRET = fallbackSecret;
      
      // Mock getting the session
      mockDynamoDB.getItem.mockImplementation(async () => mockSession);
      
      // Mock the secrets utility to throw an error
      mockSecretsUtil.getCsrfSecret.mockImplementation(async () => {
        throw new Error("Secrets Manager error");
      });
      
      // Mock the hash function
      mockAuthChallengeService.hashPassword.mockImplementation(() => testHash);
      
      // Act
      const newToken = await sessionService.rotateCsrfToken(sessionId);
      
      // Assert
      expect(newToken).toBe(testHash.substring(0, 32));
      expect(mockDynamoDB.updateItem).toHaveBeenCalled();
    });
    
    it("should not rotate token if session is invalid or expired", async () => {
      // Arrange
      const sessionId = "invalid-session";
      
      // Mock getting the session to return null (invalid session)
      mockDynamoDB.getItem.mockImplementation(async () => null);
      
      // Act
      const result = await sessionService.rotateCsrfToken(sessionId);
      
      // Assert
      expect(result).toBeNull();
      expect(mockSecretsUtil.getCsrfSecret).not.toHaveBeenCalled();
      expect(mockDynamoDB.updateItem).not.toHaveBeenCalled();
    });
  });
});