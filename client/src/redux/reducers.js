import {combineReducers} from 'redux';

function account(state = {}, action) {
    switch (action.type) {
        case 'LOGGING_IN':
            return { ...state, loggingIn: true, loggedIn: false, error: false}
        case 'LOGGED_IN':
            return { ...state, loggingIn: false, loggedIn: true, web3: action.web3 }
        case 'LOGIN_FAILED':
            return { ...state, loggingIn: false, loggedIn: false, error: action.error}
        case 'ACCOUNT_LOADED':
            return { ...state, account: action.account }
        case 'BALANCE_LOADED':
            return { ...state, balance: action.balance }
        case 'NETWORK_LOADED':
            return { ...state, network: action.network }
        default:
            return state;
    }
}

function display(state = {}, action) {
    switch (action.type) {
        case 'TOKEN_SELECTED':
            return { ...state, selectedToken: action.token }
        case 'USM_FORM_SELECTED':
            return { ...state, selectedUsmForm: action.mintOrRedeem }
        case "MINT_ETH_VALUE":
            return { ...state, mintEthValue: action.value}
        case "MINT_USM_VALUE":
            return { ...state, mintUsmValue: action.value}
        default:
            return state;
    }
}

const rootReducer = new combineReducers({
    account, display
});

export default rootReducer;