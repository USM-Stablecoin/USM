import { accountLoaded, loggingIn, loggedIn, loginFailed, setNetwork, balanceLoaded } from "./actions";
import { getWeb3 } from "../getWeb3";
import { subscribeToAccountsChanging } from "./subscriptions";


export const loadWeb3 = async (dispatch) => {
    dispatch(loggingIn());
    let web3 = null;
    try{
        web3 = await getWeb3();
        loadAccount(dispatch, web3).then((account) => {
            loadNetwork(dispatch, web3, account).then((network) => {
                loadBalance(dispatch, web3, account, network);
                dispatch(loggedIn(web3));
            }).catch((error) => {
                dispatch(loginFailed(error));
            });
        });
    }
    catch(error) {
        dispatch(loginFailed(error));
    }
    return web3;
}

export const loadAccount = async (dispatch, web3) => {
    const accounts = await web3.eth.getAccounts();
    const account = accounts[0];
    dispatch(accountLoaded(account));
    subscribeToAccountsChanging(dispatch, web3);
    return account;
}

export const loadNetwork = async (dispatch, web3, account) => {
    const network = await web3.eth.net.getNetworkType();
    // TODO: check for the correct network
    // if (!(network in addresses)) throw new Error("Network not supported");
    dispatch(setNetwork(network));
    return network;
}
  
export const loadBalance = async (dispatch, web3, account, network) => {
    const balance = await web3.eth.getBalance(account);
    dispatch(balanceLoaded(balance));
    // TODO: load Proxy, USM and FUM
    return balance;
}