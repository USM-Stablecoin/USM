import {get} from 'lodash';
import {createSelector} from 'reselect';

//ACCOUNT
const loggingIn = state => get(state, 'account.loggingIn', false);
export const loggingInSelector = createSelector(loggingIn, w => w);

const loggedIn = state => get(state, 'account.loggedIn', false);
export const loggedInSelector = createSelector(loggedIn, w => w);

const loggingInError = state => get(state, 'account.error', false);
export const loggingInErrorSelector = createSelector(loggingInError, w => w);

const web3 = state => get(state, 'account.web3', null);
export const web3Selector = createSelector(web3, w => w);

const account = state => get(state, 'account.account', "");
export const accountSelector = createSelector(account, w => w);

const balance = state => get(state, 'account.balance', "");
export const balanceSelector = createSelector(balance, w => w);

const network = state => get(state, 'account.network', null);
export const networkSelector = createSelector(network, w => w);

// Display
const selectedToken = state => get(state, 'display.selectedToken', "USM");
export const selectedTokenSelector = createSelector(selectedToken, v => v);

const selectedUsmForm = state => get(state, 'display.selectedUsmForm', "usm_mint");
export const selectedUsmFormSelector = createSelector(selectedUsmForm, v => v);

const mintEthValue = state => get(state, 'display.mintEthValue', 0);
export const mintEthValueSelector = createSelector(mintEthValue, v => v);

const mintUsmValue = state => get(state, 'display.mintUsmValue', 0);
export const mintUsmValueSelector = createSelector(mintUsmValue, v => v);