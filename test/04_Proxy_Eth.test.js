const { BN, expectRevert } = require('@openzeppelin/test-helpers')
const { expect } = require('chai')
const { id } = require('ethers/lib/utils')

const TestOracle = artifacts.require('./TestOracle.sol')
const WETH9 = artifacts.require('WETH9')
const USM = artifacts.require('./USM.sol')
const FUM = artifacts.require('./FUM.sol')
const Proxy = artifacts.require('./Proxy.sol')

const burnSignature = id('burn(address,address,uint256)').slice(0, 10)
const defundSignature = id('defund(address,address,uint256)').slice(0, 10)

require('chai').use(require('chai-as-promised')).should()

contract('USM - Proxy - Eth', (accounts) => {
  let [deployer, user1, user2] = accounts

  const sides = { BUY: 0, SELL: 1 }
  const price = new BN('25000000000')
  const shift = new BN('8')
  const MAX = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  const ZERO = new BN('0')
  const WAD = new BN('1000000000000000000')
  const oneEth = WAD
  const oneUsm = WAD
  const priceWAD = WAD.mul(price).div(new BN('10').pow(shift))

  describe('mints and burns a static amount', () => {
    let oracle, weth, usm, proxy

    beforeEach(async () => {
      // Deploy contracts
      oracle = await TestOracle.new(price, shift, { from: deployer })
      weth = await WETH9.new({ from: deployer })
      usm = await USM.new(oracle.address, weth.address, { from: deployer })
      fum = await FUM.at(await usm.fum())
      proxy = await Proxy.new(usm.address, weth.address, { from: deployer })

      await usm.addDelegate(proxy.address, burnSignature, MAX, { from: user1 })
      await usm.addDelegate(proxy.address, defundSignature, MAX, { from: user1 })
    })

    describe('minting and burning', () => {

      it('allows minting FUM', async () => {

        await proxy.fundWithEth(user2, 0, { from: user1, value: oneEth })

        const newEthPool = (await weth.balanceOf(usm.address))
        newEthPool.toString().should.equal(oneEth.toString())
      })

      it('does not mint FUM if minimum not reached', async () => {
        await expectRevert(
          proxy.fundWithEth(user2, MAX, { from: user1, value: oneEth }),
          "Limit not reached",
        )
      })

      describe('with existing FUM supply', () => {
        beforeEach(async () => {
          await proxy.fundWithEth(user1, 0, { from: user1, value: oneEth })
        })

        it('allows minting USM', async () => {
          await proxy.mintWithEth(user2, 0, { from: user1, value: oneEth })
          const usmBalance = (await usm.balanceOf(user2))
          usmBalance.toString().should.equal(oneEth.mul(priceWAD).div(WAD).toString())
        })

        it('does not mint USM if minimum not reached', async () => {
          await expectRevert(
            proxy.mintWithEth(user2, MAX, { from: user1, value: oneEth }),
            "Limit not reached",
          )
        })  

        describe('with existing USM supply', () => {
          beforeEach(async () => {
            await proxy.mintWithEth(user1, 0, { from: user1, value: oneEth })
          })

          it('allows burning FUM', async () => {
            const targetFumBalance = oneEth.mul(priceWAD).div(WAD) // see "allows minting FUM" above
            const startingBalance = await web3.eth.getBalance(user2)

            await proxy.defundForEth(user2, priceWAD.mul(new BN('3')).div(new BN('4')), 0, { from: user1 }) // defund 75% of our fum
            const newFumBalance = (await fum.balanceOf(user1))
            newFumBalance.toString().should.equal(targetFumBalance.div(new BN('4')).toString()) // should be 25% of what it was

            expect(await web3.eth.getBalance(user2)).bignumber.gt(startingBalance)
          })

          it('does not burn FUM if minimum not reached', async () => {
            await expectRevert(
              proxy.defundForEth(user2, priceWAD.mul(new BN('3')).div(new BN('4')), MAX, { from: user1 }),
              "Limit not reached",
            )
          })    

          it('allows burning USM', async () => {
            const usmBalance = (await usm.balanceOf(user1)).toString()
            const startingBalance = await web3.eth.getBalance(user2)

            await proxy.burnForEth(user2, usmBalance, 0, { from: user1 })
            const newUsmBalance = (await usm.balanceOf(user1))
            newUsmBalance.toString().should.equal('0')

            expect(await web3.eth.getBalance(user2)).bignumber.gt(startingBalance)
          })

          it('does not burn USM if minimum not reached', async () => {
            const usmBalance = (await usm.balanceOf(user1)).toString()

            await expectRevert(
              proxy.burnForEth(user2, usmBalance, MAX, { from: user1 }),
              "Limit not reached",
            )
          })    
        })
      })
    })
  })
})