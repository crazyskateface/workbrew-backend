// get placeHandler (and all the other lambda handlers)
import {getAllPlaces as rawGetAllPlaces, getPlacesNearby as rawGetPlacesNearby, getPlace as rawGetPlace, createPlace as rawCreatePlace, updatePlace as rawUpdatePlace, deletePlace as rawDeletePlace} from './handlers/placeHandler.js'
import { getUser as rawGetUser, updateUser as rawUpdateUser, setAdminStatus as rawSetAdminStatus, validateAdmin as rawValidateAdmin, getCurrentSession as rawGetCurrentSession, extendSession as rawExtendSession } from './handlers/userHandler.js';
import { 
    login as rawLogin, 
    register as rawRegister, 
    confirmRegistration as rawConfirmRegistration, 
    respondToNewPasswordChallenge as rawRespondToNewPasswordChallenge,
    requestChallenge as rawRequestChallenge,
    loginWithChallenge as rawLoginWithChallenge,
    logout as rawLogout,
    forgotPassword as rawForgotPassword,
    confirmForgotPassword as rawConfirmForgotPassword
} from './handlers/authHandler.js';
import { withSession, withSessionAndCsrf, withCors } from './middleware/applyMiddleware.js';

// Apply middleware to handlers
// Public routes (only need CORS, no session or CSRF needed)
export const getAllPlaces = withCors(rawGetAllPlaces);
export const getPlacesNearby = withCors(rawGetPlacesNearby);
export const getPlace = withCors(rawGetPlace);
export const register = withCors(rawRegister);
export const confirmRegistration = withCors(rawConfirmRegistration);
export const requestChallenge = withCors(rawRequestChallenge);
export const forgotPassword = withCors(rawForgotPassword);
export const confirmForgotPassword = withCors(rawConfirmForgotPassword);

// Authentication endpoints - only need CORS, not session or CSRF
// (You can't have a CSRF token before logging in)
export const login = withCors(rawLogin);
export const loginWithChallenge = withCors(rawLoginWithChallenge);
export const respondToNewPasswordChallenge = withCors(rawRespondToNewPasswordChallenge);

// Routes that need session but not CSRF (GET requests, or session-related endpoints)
export const getCurrentSession = withSession(rawGetCurrentSession);

// Routes that need both session and CSRF protection
export const createPlace = withSessionAndCsrf(rawCreatePlace);
export const updatePlace = withSessionAndCsrf(rawUpdatePlace);
export const deletePlace = withSessionAndCsrf(rawDeletePlace);
export const getUser = withSessionAndCsrf(rawGetUser);
export const updateUser = withSessionAndCsrf(rawUpdateUser);
export const setAdminStatus = withSessionAndCsrf(rawSetAdminStatus);
export const validateAdmin = withSessionAndCsrf(rawValidateAdmin);
export const logout = withSessionAndCsrf(rawLogout);
export const extendSession = withSessionAndCsrf(rawExtendSession);