import { createStore, applyMiddleware, compose } from "redux";
import { createLogger }  from "redux-logger";
import rootReducer from "./reducers";

const loggerMiddleware = createLogger();
const middleware = [];

//connects redux browser to app
const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

export default function configureStore(preLoadedState){
    return createStore(
        rootReducer, 
        preLoadedState,
        composeEnhancers(applyMiddleware(...middleware, loggerMiddleware))
    );
}