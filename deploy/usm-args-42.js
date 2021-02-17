const addresses = {
    'oracle': '0x8e91D25324833D62Fb3eC67aDEE26048696c8909',
    'USMv0.1': '0x21453979384f21D09534f8801467BDd5d90eCD6C',
    'FUMv0.1': '0x96F8F5323Aa6CB0e6F311bdE6DEEFb1c81Cb1898',
    'USMv0.2-rc1': '0xf05627D4F72bC4778BAECcbeaCa44b013e9b8227',
    'FUMv0.2-rc1': '0xe13b57555e5a538785130fda6e918185b9fe1599',
    'USMv0.2': '0x6dcc375aE1f43c8FA4e13D56E6ec584BeE25A88F',
    'FUMv0.2': '0xf99b440d8e18f850187ae53cdd4ebc959ebf36df',
}
  
module.exports = [
    addresses['oracle'],
    [
        addresses['USMv0.1'],
        addresses['FUMv0.1'],
        addresses['USMv0.2-rc1'],
        addresses['FUMv0.2-rc1'],
        addresses['USMv0.2'],
        addresses['FUMv0.2'],
    ],
];