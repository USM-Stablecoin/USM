export function loggingIn(){
    return {
        type: 'LOGGING_IN'
    }
}

export function loggedIn(web3){
    return {
        type: 'LOGGED_IN',
        web3
    }
}

export function loginFailed(error){
    return {
        type: 'LOGIN_FAILED',
        error
    }
}

export function accountLoaded(account){
    return {
        type: 'ACCOUNT_LOADED',
        account
    }
}

export function balanceLoaded(balance){
    return {
        type: 'BALANCE_LOADED',
        balance
    }
}

export function setNetwork(network){
    return {
        type: 'NETWORK_LOADED',
        network
    }
}

export function setToken(token){
    return {
        type: 'TOKEN_SELECTED',
        token
    }
}

export function selectUsmForm(mintOrRedeem){
    return {
        type: 'USM_FORM_SELECTED',
        mintOrRedeem
    }
}

export function setMintEthValue(value) {
    return {
        type: 'MINT_ETH_VALUE',
        value
    }
}

export function setMintUsmValue(value) {
    return {
        type: 'MINT_USM_VALUE',
        value
    }
}