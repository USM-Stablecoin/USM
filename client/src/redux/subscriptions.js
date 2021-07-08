import { loadAccount } from "./interactions";

export const subscribeToAccountsChanging = async (dispatch, web3) => {
    web3.currentProvider.on('accountsChanged', function (accounts) {
        loadAccount(dispatch, web3);
    });
}