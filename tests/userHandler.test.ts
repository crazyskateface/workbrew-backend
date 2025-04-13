import { describe, it, expect, beforeAll, afterEach, mock, spyOn } from "bun:test";
import { getUser, updateUser, setAdminStatus } from "../src/handlers/userHandler.js";
import * as userService from "../src/services/userService.js";
import * as permissionService from "../src/services/permissionService.js";

describe("User Handler Tests", () => {
    beforeAll(() => {
        // Mock user service functions
        mock.module("../src/services/userService.js", () => ({
            getUserById: async (userId) => {
                if (userId === "test-user") {
                    return {
                        id: "test-user",
                        username: "testuser",
                        attributes: {
                            email: "test@example.com",
                            given_name: "Test User",
                            "custom:isAdmin": "false"
                        }
                    };
                } else if (userId === "admin-user") {
                    return {
                        id: "admin-user",
                        username: "adminuser",
                        attributes: {
                            email: "admin@example.com",
                            given_name: "Admin User",
                            "custom:isAdmin": "true"
                        }
                    };
                } else if (userId === "other-user") {
                    return {
                        id: "other-user",
                        username: "otheruser",
                        attributes: {
                            email: "other@example.com",
                            given_name: "Other User",
                            "custom:isAdmin": "false"
                        }
                    };
                }
                return null;
            },
            // Add the missing getUserByIdOrUsername mock
            getUserByIdOrUsername: async (identifier) => {
                // Reuse the same logic as getUserById for tests
                if (identifier === "test-user") {
                    return {
                        id: "test-user",
                        username: "testuser",
                        attributes: {
                            email: "test@example.com",
                            given_name: "Test User",
                            "custom:isAdmin": "false"
                        }
                    };
                } else if (identifier === "admin-user") {
                    return {
                        id: "admin-user",
                        username: "adminuser",
                        attributes: {
                            email: "admin@example.com",
                            given_name: "Admin User",
                            "custom:isAdmin": "true"
                        }
                    };
                } else if (identifier === "other-user") {
                    return {
                        id: "other-user",
                        username: "otheruser",
                        attributes: {
                            email: "other@example.com",
                            given_name: "Other User",
                            "custom:isAdmin": "false"
                        }
                    };
                }
                return null;
            },
            updateUser: async (userId, userData) => {
                const user = await userService.getUserById(userId);
                if (!user) return null;
                
                return {
                    ...user,
                    attributes: {
                        ...user.attributes,
                        ...userData
                    }
                };
            },
            setUserAdminStatus: async (userId, isAdmin) => {
                // Just mock the function, no need to implement for testing
                return;
            }
        }));
        
        // Mock permission service
        mock.module("../src/services/permissionService.js", () => ({
            isUserAdmin: async (userId) => {
                return userId === "admin-user";
            },
            hasPermission: async (userId, permission, resourceId) => {
                if (userId === "admin-user") return true;
                return false;
            }
        }));
    });
    
    afterEach(() => {
        // mock.restore();
    });
    
    describe("getUser Handler", () => {
        it("should return user data for valid user ID", async () => {
            const event = {
                pathParameters: { userId: "test-user" },
                requestContext: { 
                    authorizer: { 
                        claims: { sub: "test-user" } 
                    }
                }
            } as any;
            
            const response = await getUser(event);
            
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(JSON.parse(body.message).id).toBe("test-user");
            expect(JSON.parse(body.message).attributes.email).toBe("test@example.com");
        });
        
        it("should return 404 for non-existent user", async () => {
            const event = {
                pathParameters: { userId: "non-existent" },
                requestContext: { 
                    authorizer: { 
                        claims: { sub: "test-user" }
                    }
                }
            } as any;
            
            const response = await getUser(event);
            
            expect(response.statusCode).toBe(404);
        });
    });
    
    describe("updateUser Handler", () => {
        it("should update user data for self", async () => {
            const event = {
                pathParameters: { userId: "test-user" },
                requestContext: { 
                    authorizer: { 
                        claims: { sub: "test-user" }
                    }
                },
                body: JSON.stringify({
                    given_name: "Updated Name"
                })
            } as any;
            
            const response = await updateUser(event);
            
            expect(response.statusCode).toBe(200);
        });
        
        it("should return 403 when updating another user", async () => {
            const event = {
                pathParameters: { userId: "other-user" },
                requestContext: { 
                    authorizer: { 
                        claims: { sub: "test-user" }
                    }
                },
                body: JSON.stringify({
                    given_name: "Updated Name"
                })
            } as any;
            
            const response = await updateUser(event);
            
            expect(response.statusCode).toBe(403);
        });
    });
    
    describe("setAdminStatus Handler", () => {
        it("should allow admin to change admin status", async () => {
            const event = {
                pathParameters: { userId: "test-user" },
                requestContext: { 
                    authorizer: { 
                        claims: { sub: "admin-user" }
                    }
                },
                body: JSON.stringify({
                    isAdmin: true
                })
            } as any;
            
            const response = await setAdminStatus(event);
            
            expect(response.statusCode).toBe(200);
        });
        
        it("should deny non-admin from changing admin status", async () => {
            const event = {
                pathParameters: { userId: "other-user" },
                requestContext: { 
                    authorizer: { 
                        claims: { sub: "test-user" }
                    }
                },
                body: JSON.stringify({
                    isAdmin: true
                })
            } as any;
            
            const response = await setAdminStatus(event);
            
            expect(response.statusCode).toBe(403);
        });
    });
});