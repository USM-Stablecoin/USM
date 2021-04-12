const func = async function ({ deployments, getNamedAccounts, getChainId }) {
  const { deploy, execute, get, read } = deployments;
  const { deployer } = await getNamedAccounts();
  const chainId = await getChainId()

  let oracleAddress
  if (chainId === '42') {
    oracleAddress = (await get('MockChainlinkOracle')).address;
  } else {
    oracleAddress = (await get('MedianOracle')).address;
  }

  const usm = await deploy('USM', {
    from: deployer,
    deterministicDeployment: true,
    args: require(`./usm-args-${chainId}`),
  })
  console.log(`Deployed USM to ${usm.address}`);
  console.log(`Deployed FUM to ${ await read('USM', { from: deployer }, 'fum') }`);
};

module.exports = func;
module.exports.tags = ["USM"];
