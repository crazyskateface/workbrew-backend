// get placeHandler (and all the other lambda handlers)
import {getAllPlaces, getPlacesNearby, getPlace, createPlace, updatePlace, deletePlace} from './handlers/placeHandler.js'

// Exports the handlers explicitly
// exports.getAllPlaces = getAllPlaces;
// exports.getPlace = getPlace;
// exports.createPlace = createPlace;
export {getAllPlaces, getPlacesNearby, getPlace, createPlace, updatePlace, deletePlace};
export { getUser, updateUser, setAdminStatus, validateAdmin, getCurrentSession } from './handlers/userHandler.js';