const { BN, expectRevert } = require('@openzeppelin/test-helpers')

const TestOracle = artifacts.require('TestOracle')
const USM = artifacts.require('USM')
const USMView = artifacts.require('USMView')

const EVM_REVERT = 'VM Exception while processing transaction: revert'

require('chai').use(require('chai-as-promised')).should()

contract('USM - Internal functions', (accounts) => {
  const [deployer, user1, user2, user3] = accounts
  let usm, usmView
  const rounds = { DOWN: 0, UP: 1 }

  const ZERO = new BN('0')
  const WAD = new BN('1000000000000000000')
  const price = new BN('250')
  const priceWAD = price.mul(WAD)

  beforeEach(async () => {
    oracle0 = await TestOracle.new(priceWAD, { from: deployer })
    oracle1 = await TestOracle.new(priceWAD.div(new BN('2')), { from: deployer })
    usm = await USM.new(oracle0.address, oracle1.address, [], { from: deployer })
    await usm.refreshPrice()    // Ensures the savedPrice set in TestOracle is also set in usm.storedPrice
    usmView = await USMView.new(usm.address, { from: deployer })
  })

  describe('functionality', async () => {
    it('returns the oracle price in WAD', async () => {
      const oraclePrice = (await usm.latestPrice())[0]
      oraclePrice.toString().should.equal(priceWAD.toString())
    })

    it('returns the value of eth in usm', async () => {
      const oneEth = WAD
      const equivalentUSM = oneEth.mul(priceWAD).div(WAD)
      const usmAmount = await usmView.ethToUsm(oneEth, rounds.DOWN)
      usmAmount.toString().should.equal(equivalentUSM.toString())
    })

    it('returns the value of usm in eth', async () => {
      const oneUsm = WAD
      const equivalentEth = oneUsm.mul(WAD).div(priceWAD)
      const ethAmount = await usmView.usmToEth(oneUsm, rounds.DOWN)
      ethAmount.toString().should.equal(equivalentEth.toString())
    })

    it('returns the debt ratio as zero', async () => {
      const ZERO = new BN('0')
      const debtRatio = (await usmView.debtRatio())
      debtRatio.toString().should.equal(ZERO.toString())
    })
  })
})
