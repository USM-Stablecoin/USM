import Web3 from 'web3';
import Authereum from "authereum";
import Web3Modal from "web3modal";

const providerOptions = {
	authereum: {
		package: Authereum, // required
	},
};

const web3Modal = new Web3Modal({
	network: "mainnet", // optional
	providerOptions: providerOptions, // required
});

export const getWeb3 = async () => {
	const provider = await web3Modal.connect();

	return new Web3(provider);
};