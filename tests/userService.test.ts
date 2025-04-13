import { describe, it, expect, beforeAll, afterEach, spyOn } from "bun:test";
import { getUserById, updateUser, setUserAdminStatus } from '../src/services/userService.js';
import * as userService from '../src/services/userService.js';
import { mockClient } from 'aws-sdk-client-mock';
import { 
    CognitoIdentityProviderClient, 
    AdminGetUserCommand, 
    AdminUpdateUserAttributesCommand 
} from '@aws-sdk/client-cognito-identity-provider';
import 'dotenv/config';

// Set a value for USER_POOL_ID in the test environment
process.env.USER_POOL_ID = 'test-user-pool';

const cognitoMock = mockClient(CognitoIdentityProviderClient);

describe("User Service Tests", () => {
    beforeAll(() => {
        // Reset the mock before all tests
        cognitoMock.reset();
        
        // Mock AdminGetUserCommand
        cognitoMock.on(AdminGetUserCommand).callsFake(params => {
            console.log('Mock AdminGetUserCommand called with:', params);
            
            // Depending on which userId is passed, return different mock data
            if (params.Username === "user-1") {
                return {
                    Username: "user-1",
                    UserAttributes: [
                        { Name: "email", Value: "user1@example.com" },
                        { Name: "given_name", Value: "Test User" },
                        { Name: "custom:isAdmin", Value: "false" }
                    ]
                };
            } else if (params.Username === "admin-1") {
                return {
                    Username: "admin-1",
                    UserAttributes: [
                        { Name: "email", Value: "admin1@example.com" },
                        { Name: "given_name", Value: "Admin User" },
                        { Name: "custom:isAdmin", Value: "true" }
                    ]
                };
            }
            throw new Error("UserNotFoundException");
        });
        cognitoMock.on(AdminUpdateUserAttributesCommand).callsFake(params => {
            console.log('Mock AdminUpdateUserAttributesCommand called with:', params);
            
            // Simulate successful update
            return {
                Username: "user-1",
                UserAttributes: params.UserAttributes
            };
        });

        // Mock AdminUpdateUserAttributesCommand
        // cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});
    });

    afterEach(() => {
        // Reset the mock after each test
        cognitoMock.reset();
    });

    describe("User Management", () => {
        it("should get a user by ID", async () => {
            const spy = spyOn(userService, 'getUserById');
            const user = await getUserById("user-1");
            console.log('[get user test]... user: ', user);
            expect(spy).toHaveBeenCalledWith("user-1");
            expect(user).not.toBeNull();
            expect(user?.username).toBe("user-1");
            expect(user?.attributes.email).toBe("user1@example.com");
            expect(user?.attributes["custom:isAdmin"]).toBe("false");
        });

        it("should update user attributes", async () => {
            const userData = { given_name: "Updated Name", email: "updated@example.com" };
            const updatedUser = await updateUser("user-1", userData);
            expect(updatedUser).not.toBeNull();
            expect(updatedUser?.attributes.email).toBe("updated@example.com");
            expect(updatedUser?.attributes.given_name).toBe("Updated Name");
        });

        it("should set user admin status", async () => {
            await setUserAdminStatus("user-1", true);
            const user = await getUserById("user-1");
            expect(user?.attributes["custom:isAdmin"]).toBe("true");
        });
    });
});