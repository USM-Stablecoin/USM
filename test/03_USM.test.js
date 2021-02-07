const { BN, expectRevert } = require('@openzeppelin/test-helpers')
const { web3 } = require('@openzeppelin/test-helpers/src/setup')
const timeMachine = require('ganache-time-traveler')

const Aggregator = artifacts.require('MockChainlinkAggregatorV3')
const UniswapAnchoredView = artifacts.require('MockUniswapAnchoredView')
const UniswapV2Pair = artifacts.require('MockUniswapV2Pair')

const WadMath = artifacts.require('MockWadMath')
const MedianOracle = artifacts.require('MockMedianOracle')
const ChainlinkOracle = artifacts.require('MockChainlinkOracle')
const USM = artifacts.require('USM')
const FUM = artifacts.require('FUM')
const USMView = artifacts.require('USMView')

require('chai').use(require('chai-as-promised')).should()

contract('USM', (accounts) => {
  const [deployer, user1, user2, user3, optOut1, optOut2] = accounts
  const [ZERO, ONE, TWO, FOUR, SIX, EIGHT, EIGHTEEN, HUNDRED, THOUSAND, WAD] =
        [0, 1, 2, 4, 6, 8, 18, 100, 1000, '1000000000000000000'].map(function (n) { return new BN(n) })
  const WAD_MINUS_1 = WAD.sub(ONE)
  const sides = { BUY: 0, SELL: 1 }
  const rounds = { DOWN: 0, UP: 1 }
  const oneEth = WAD
  const oneUsm = WAD
  const oneFum = WAD
  const MINUTE = 60
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  let priceWAD
  let oneDollarInEth
  const shift = '18'

  let aggregator
  const chainlinkPrice = '38598000000'                      // 8 dec places: see ChainlinkOracle

  let anchoredView
  const compoundPrice = '414174999'                         // 6 dec places: see CompoundOpenOracle

  let usdcEthPair
  const usdcDecimals = SIX                                  // See UniswapMedianTWAPOracle
  const ethDecimals = EIGHTEEN                              // See UniswapMedianTWAPOracle
  const uniswapTokensInReverseOrder = true                  // See UniswapMedianTWAPOracle

  const usdcEthCumPrice0_0 = new BN('307631784275278277546624451305316303382174855535226')  // From the USDC/ETH pair
  const usdcEthCumPrice1_0 = new BN('31375939132666967530700283664103')
  const usdcEthTimestamp_0 = new BN('1606780664')
  const usdcEthCumPrice0_1 = new BN('307634635050611880719301156089846577363471806696356')
  const usdcEthCumPrice1_1 = new BN('31378725947216452626380862836246')
  const usdcEthTimestamp_1 = new BN('1606782003')

  function wadMul(x, y, upOrDown) {
    return ((x.mul(y)).add(upOrDown == rounds.DOWN ? ZERO : WAD_MINUS_1)).div(WAD)
  }

  function wadDiv(x, y, upOrDown) {
    return ((x.mul(WAD)).add(y.sub(ONE))).div(y)
  }

  function wadDecay(adjustment, decayFactor) {
    return WAD.add(wadMul(adjustment, decayFactor, rounds.DOWN)).sub(decayFactor)
  }

  function shouldEqual(x, y) {
    x.toString().should.equal(y.toString())
  }

  function shouldEqualApprox(x, y) {
    // Check that abs(x - y) < 0.0000001(x + y):
    const diff = x.sub(y).abs()
    diff.should.be.bignumber.lte(x.add(y).abs().div(new BN(1000000)))
  }

  function fl(w) { // Converts a WAD fixed-point (eg, 2.7e18) to an unscaled float (2.7).  Of course may lose a bit of precision
    return parseFloat(w) / WAD
  }

  // Converts a JavaScript Number to a BN (bignumber).  May lose some precision for large numbers, but at least the approach
  // here, via BigInts, isn't totally broken like the simple new BN(x), or new BN(x.toString()).  Eg:
  // x = 10**23
  // x.toString()                          -> "1e+23"
  // new BN(x)                             -> fails with "Error: Assertion failed" (?)
  // new BN(x.toString())                  -> 23523 (??)
  // bn(x) = new BN(BigInt(Math.round(x))) -> 99999999999999991611392 (imperfect precision, but at least in the ballpark)
  function bn(x) {
    return new BN(BigInt(Math.round(parseFloat(x))))
  }

  function wad(x) {
    return new BN(BigInt(Math.round(parseFloat(x) * WAD)))
  }

  // ____________________ Deployment ____________________

  describe("mints and burns a static amount", () => {
    let oracle, backupOracle, usm, fum, usmView, ethPerFund, ethPerMint, bitOfEth, snapshot, snapshotId

    beforeEach(async () => {
      // Oracle params

      aggregator = await Aggregator.new({ from: deployer })
      await aggregator.set(chainlinkPrice)

      anchoredView = await UniswapAnchoredView.new({ from: deployer })
      await anchoredView.set(compoundPrice)

      usdcEthPair = await UniswapV2Pair.new({ from: deployer })
      await usdcEthPair.setReserves(0, 0, usdcEthTimestamp_0)
      await usdcEthPair.setCumulativePrices(usdcEthCumPrice0_0, usdcEthCumPrice1_0)

      // USM
      oracle = await MedianOracle.new(aggregator.address, anchoredView.address,
                                      usdcEthPair.address, usdcDecimals, ethDecimals, uniswapTokensInReverseOrder,
                                      { from: deployer })
      backupOracle = await ChainlinkOracle.new(aggregator.address, { from: deployer })
      usm = await USM.new(oracle.address, backupOracle.address, [optOut1, optOut2], { from: deployer })
      await usm.refreshPrice()  // This call stores the Uniswap cumPriceSeconds record for time usdcEthTimestamp_0
      fum = await FUM.at(await usm.fum())
      usmView = await USMView.new(usm.address, { from: deployer })

      await usdcEthPair.setReserves(0, 0, usdcEthTimestamp_1)
      await usdcEthPair.setCumulativePrices(usdcEthCumPrice0_1, usdcEthCumPrice1_1)
      await usm.refreshPrice()  // ...And this stores the cumPriceSeconds for usdcEthTimestamp_1 - so we have a valid TWAP now

      priceWAD = (await usm.latestPrice())[0]
      oneDollarInEth = wadDiv(WAD, priceWAD, rounds.UP)

      ethPerFund = oneEth.mul(TWO)                  // Can be any (?) number
      ethPerMint = oneEth.mul(FOUR)                 // Can be any (?) number
      bitOfEth = oneEth.div(THOUSAND)

      snapshot = await timeMachine.takeSnapshot()
      snapshotId = snapshot['result']

    })

    afterEach(async () => {
      await timeMachine.revertToSnapshot(snapshotId)
    })

    describe("deployment", () => {
      it("starts with correct FUM price", async () => {
        const fumBuyPrice = await usmView.fumPrice(sides.BUY)
        // The FUM price should start off equal to $1, in ETH terms = 1 / price:
        shouldEqualApprox(fumBuyPrice, oneDollarInEth)

        const fumSellPrice = await usmView.fumPrice(sides.SELL)
        shouldEqualApprox(fumSellPrice, oneDollarInEth)
      })
    })

    // ____________________ Minting and burning ____________________

    describe("minting and burning", () => {
      let MAX_DEBT_RATIO

      beforeEach(async () => {
        MAX_DEBT_RATIO = await usm.MAX_DEBT_RATIO()
      })

      it("doesn't allow minting USM before minting FUM", async () => {
        await expectRevert(usm.mint(user1, 0, { from: user2, value: ethPerMint }), "Fund before minting")
      })

      it("allows minting FUM (at flat price)", async () => {
        const price0 = (await usm.latestPrice())[0]

        await usm.fund(user2, 0, { from: user1, value: ethPerFund })

        // Uses flat FUM price until USM is minted
        const ethPool = await usm.ethPool()
        const targetEthPool = ethPerFund
        shouldEqual(ethPool, targetEthPool)

        // Check that the FUM created was just based on straight linear pricing - qty * price:
        const user2FumBalance = await fum.balanceOf(user2)
        const targetTotalFumSupply = wadMul(ethPool, priceWAD, rounds.DOWN)
        shouldEqualApprox(user2FumBalance, targetTotalFumSupply)    // Only approx b/c fumFromFund() loses some precision
        const totalFumSupply = await fum.totalSupply()
        shouldEqualApprox(totalFumSupply, targetTotalFumSupply)

        // And relatedly, buySellAdjustment should be unchanged (1), and FUM buy price and FUM sell price should still be $1:
        const buySellAdj = await usm.buySellAdjustment()
        shouldEqual(buySellAdj, WAD)
        const price = (await usm.latestPrice())[0]
        shouldEqual(price, price0)

        const usmBuyPrice = await usmView.usmPrice(sides.BUY)
        shouldEqualApprox(usmBuyPrice, oneDollarInEth)
        const usmSellPrice = await usmView.usmPrice(sides.SELL)
        shouldEqualApprox(usmSellPrice, oneDollarInEth)

        const fumBuyPrice = await usmView.fumPrice(sides.BUY)
        shouldEqualApprox(fumBuyPrice, oneDollarInEth)
        const fumSellPrice = await usmView.fumPrice(sides.SELL)
        shouldEqualApprox(fumSellPrice, oneDollarInEth)
      })

      describe("with existing FUM supply", () => {
        beforeEach(async () => {
          await usm.fund(user2, 0, { from: user1, value: ethPerFund })
        })

        it("allows minting USM", async () => {
          await usm.mint(user1, 0, { from: user2, value: ethPerMint })
        })

        describe("with existing USM supply", () => {
          let ethPool0, price0, debtRatio0, user1UsmBalance0, totalUsmSupply0, user2FumBalance0, totalFumSupply0, buySellAdj0,
              fumBuyPrice0, fumSellPrice0, usmBuyPrice0, usmSellPrice0

          beforeEach(async () => {
            await usm.mint(user1, 0, { from: user2, value: ethPerMint })

            ethPool0 = await usm.ethPool()                      // "0" suffix = initial values (after first fund() + mint())
            price0 = (await usm.latestPrice())[0]
            debtRatio0 = await usmView.debtRatio()
            user1UsmBalance0 = await usm.balanceOf(user1)
            totalUsmSupply0 = await usm.totalSupply()
            user2FumBalance0 = await fum.balanceOf(user2)
            totalFumSupply0 = await fum.totalSupply()
            buySellAdj0 = await usm.buySellAdjustment()
            fumBuyPrice0 = await usmView.fumPrice(sides.BUY)
            fumSellPrice0 = await usmView.fumPrice(sides.SELL)
            usmBuyPrice0 = await usmView.usmPrice(sides.BUY)
            usmSellPrice0 = await usmView.usmPrice(sides.SELL)
          })

          // ____________________ Minting FUM (aka fund()) ____________________

          it("calculates log/exp correctly", async () => {
            const w = await WadMath.new()
            const a = new BN('987654321098765432')    //  0.987654321098765432
            const b = new BN('12345678901234567890')  // 12.345678901234567890

            const logA = await w.wadLog(a)
            const targetLogA = wad(Math.log(fl(a)))
            shouldEqualApprox(logA, targetLogA)
            const logB = await w.wadLog(b)
            const targetLogB = wad(Math.log(fl(b)))
            shouldEqualApprox(logB, targetLogB)

            const expA = await w.wadExp(a)
            const targetExpA = wad(Math.exp(fl(a)))
            shouldEqualApprox(expA, targetExpA)
            const expB = await w.wadExp(b)
            const targetExpB = wad(Math.exp(fl(b)))
            //console.log("    expB: " + b + ", " + expB + ", " + targetExpB)
            shouldEqualApprox(expB, targetExpB)

            const expAB = await w.wadExp(a, b)
            const targetExpAB = wad(fl(a)**fl(b))
            shouldEqualApprox(expAB, targetExpAB)
            const expBA = await w.wadExp(b, a)
            const targetExpBA = wad(fl(b)**fl(a))
            shouldEqualApprox(expBA, targetExpBA)
          })

          it("allows minting FUM (at sliding price)", async () => {
            await usm.fund(user2, 0, { from: user1, value: ethPerFund })
          })

          describe("with FUM minted at sliding price", () => {
            let ethPoolF, priceF, debtRatioF, user2FumBalanceF, totalFumSupplyF, buySellAdjF, fumBuyPriceF, fumSellPriceF,
                usmBuyPriceF, usmSellPriceF, effectiveUsmQty0, adjGrowthFactorF

            beforeEach(async () => {
              await usm.fund(user2, 0, { from: user1, value: ethPerFund })

              ethPoolF = await usm.ethPool()                    // "F" suffix = values after this fund() call
              priceF = (await usm.latestPrice())[0]
              debtRatioF = await usmView.debtRatio()
              user2FumBalanceF = await fum.balanceOf(user2)
              totalFumSupplyF = await fum.totalSupply()
              buySellAdjF = await usm.buySellAdjustment()
              fumBuyPriceF = await usmView.fumPrice(sides.BUY)
              fumSellPriceF = await usmView.fumPrice(sides.SELL)
              usmBuyPriceF = await usmView.usmPrice(sides.BUY)
              usmSellPriceF = await usmView.usmPrice(sides.SELL)

              // See USMTemplate.fumFromFund() for the math we're mirroring here:
              effectiveUsmQty0 = Math.min(fl(totalUsmSupply0), fl(ethPool0) * fl(price0) * fl(MAX_DEBT_RATIO))
              const effectiveDebtRatio = effectiveUsmQty0 / (fl(ethPool0) * fl(price0))
              const effectiveFumDelta = 1 / (1 - effectiveDebtRatio)
              adjGrowthFactorF = (ethPoolF / ethPool0)**(effectiveFumDelta / 2)
            })

            it("increases ETH pool correctly when minting FUM", async () => {
              const targetEthPoolF = ethPool0.add(ethPerFund)
              shouldEqual(ethPoolF, targetEthPoolF)
            })

            it("increases buySellAdjustment correctly when minting FUM", async () => {
              buySellAdjF.should.be.bignumber.gt(buySellAdj0)
              const targetBuySellAdjF = wad(fl(buySellAdj0) * adjGrowthFactorF)
              shouldEqualApprox(buySellAdjF, targetBuySellAdjF)
            })

            it("increases ETH mid price correctly when minting FUM", async () => {
              const targetPriceF = wad(fl(price0) * adjGrowthFactorF)
              shouldEqualApprox(priceF, targetPriceF)
            })

            it("increases FUM buy and sell prices correctly when minting FUM", async () => {
              // Note - this doesn't account for the dr > max case, where minFumBuyPrice becomes active:
              const fumMidPriceF = (fl(ethPoolF) - fl(totalUsmSupply0) / fl(priceF)) / fl(totalFumSupplyF)
              const targetFumBuyPriceF = wad(Math.max(1, fl(buySellAdjF)) * fumMidPriceF)
              shouldEqualApprox(fumBuyPriceF, targetFumBuyPriceF)
              const targetFumSellPriceF = wad(Math.max(0, Math.min(1, fl(buySellAdjF)) * fumMidPriceF))
              shouldEqualApprox(fumSellPriceF, targetFumSellPriceF)
            })

            it("reduces USM buy and sell prices when minting FUM", async () => {
              // Minting FUM both 1. pushes ETH mid price up and 2. pushes buySellAdj up.  Both of these are good for USM
              // buyers/minters (usmBuyPrice down), and bad for USM sellers/burners (usmSellPrice down):
              usmBuyPriceF.should.be.bignumber.lt(usmBuyPrice0)
              usmSellPriceF.should.be.bignumber.lt(usmSellPrice0)
            })

            it("increases FUM supply correctly when minting FUM", async () => {
              // Math from USMTemplate.fumFromFund():
              const avgFumBuyPrice = fl(buySellAdj0) * (fl(ethPool0) - effectiveUsmQty0 / fl(priceF)) / fl(totalFumSupply0)
              const targetFumOut = wad(fl(ethPerFund) / avgFumBuyPrice)
              const targetTotalFumSupplyF = totalFumSupply0.add(targetFumOut)
              shouldEqualApprox(user2FumBalanceF, targetTotalFumSupplyF)
              shouldEqualApprox(totalFumSupplyF, targetTotalFumSupplyF)
            })

            it("reduces debtRatio when minting FUM", async () => {
              debtRatioF.should.be.bignumber.lt(debtRatio0)
            })

            it("decays buySellAdjustment over time", async () => {
              // Check that buySellAdjustment decays properly (well, approximately) over time:
              // - Start with an adjustment j != 1.
              // - Use timeMachine to move forward 180 secs = 3 min.
              // - Since USM.BUY_SELL_ADJUSTMENT_HALF_LIFE = 60 (1 min), 3 min should mean a decay of ~1/8.
              // - The way our "time decay towards 1" approximation works, decaying j by ~1/8 should yield 1 + (j * 1/8) - 1/8.
              //   (See comment in USM.buySellAdjustment().)

              // Need buySellAdj to be active (ie, != 1) for this test to be meaningful.  After fund() above it should be > 1:
              buySellAdjF.should.be.bignumber.gt(buySellAdj0)

              const block0 = await web3.eth.getBlockNumber()
              const t0 = (await web3.eth.getBlock(block0)).timestamp
              const timeDelay = 3 * MINUTE
              await timeMachine.advanceTimeAndBlock(timeDelay)
              const block1 = await web3.eth.getBlockNumber()
              const t1 = (await web3.eth.getBlock(block1)).timestamp
              shouldEqual(t1, t0 + timeDelay)

              const buySellAdj = await usm.buySellAdjustment()
              const decayFactor = wadDiv(ONE, EIGHT, rounds.DOWN)
              const targetBuySellAdj = wadDecay(buySellAdjF, decayFactor)
              shouldEqualApprox(buySellAdj, targetBuySellAdj)
            })
          })

          it("reduces minFumBuyPrice over time", async () => {
            // Move price to get debt ratio just *above* MAX:
            //const targetDebtRatio1 = MAX_DEBT_RATIO.add(WAD.div(HUNDRED)) // Eg, 80% + 1% = 81%
            const targetDebtRatio1 = WAD    // 100%.  More is OK but between 80% and 100% makes the math below more complicated
            const priceChangeFactor1 = wadDiv(debtRatio0, targetDebtRatio1, rounds.UP)
            const targetPrice1 = wadMul(price0, priceChangeFactor1, rounds.DOWN)
            await oracle.setPrice(targetPrice1)
            await usm.refreshPrice()    // Need to refreshPrice() after setPrice(), to get the new value into usm.storedPrice
            const price1 = (await usm.latestPrice())[0]
            shouldEqualApprox(price1, targetPrice1)

            const debtRatio1 = await usmView.debtRatio()
            debtRatio1.should.be.bignumber.gt(MAX_DEBT_RATIO)

            // Make one tiny call to fund(), just to actually trigger the internal call to checkIfUnderwater(), with a mint()
            // before just so buySellAdj doesn't end up > 1 (which would make our FUM buy price messier):
            await usm.mint(user1, 0, { from: user2, value: ethPerMint })
            await usm.fund(user3, 0, { from: user3, value: bitOfEth })

            // Calculate targetFumBuyPrice using the math in USM.checkIfUnderwater():
            //const targetFumBuyPrice2 = wadDiv(wadMul(WAD.sub(MAX_DEBT_RATIO), ethPool0, rounds.UP), totalFumSupply0, rounds.UP)
            const ethPool2 = await usm.ethPool()
            const price2 = (await usm.latestPrice())[0]
            const totalFumSupply2 = await fum.totalSupply()
            const poolValue2 = wadMul(ethPool2, price2, rounds.DOWN)
            const usmForFumBuy2 = wadMul(poolValue2, MAX_DEBT_RATIO, rounds.DOWN)
            const ethBuffer2 = ethPool2.sub(wadDiv(usmForFumBuy2, price2, rounds.DOWN))
            const targetFumBuyPrice2 = wadDiv(ethBuffer2, totalFumSupply2, rounds.UP)

            const fumBuyPrice2 = await usmView.fumPrice(sides.BUY)
            shouldEqualApprox(fumBuyPrice2, targetFumBuyPrice2)

            // Now move forward a few days, and check that fumBuyPrice decays by the appropriate factor:
            const block0 = await web3.eth.getBlockNumber()
            const t0 = (await web3.eth.getBlock(block0)).timestamp
            const timeDelay = 3 * DAY
            await timeMachine.advanceTimeAndBlock(timeDelay)
            const block1 = await web3.eth.getBlockNumber()
            const t1 = (await web3.eth.getBlock(block1)).timestamp
            shouldEqual(t1, t0 + timeDelay)

            //const targetFumBuyPrice3 = wadMul(fumBuyPrice2, decayFactor3, rounds.UP)
            const decayFactor3 = wadDiv(ONE, EIGHT, rounds.UP)  // aka 0.5**(timeDelay / MIN_FUM_BUY_PRICE_HALF_LIFE)
            const usmForFumBuy3 = poolValue2.sub(wadMul(decayFactor3, poolValue2.sub(usmForFumBuy2), rounds.DOWN))
            const ethBuffer3 = ethPool2.sub(wadDiv(usmForFumBuy3, price2, rounds.DOWN))
            const targetFumBuyPrice3 = wadDiv(ethBuffer3, totalFumSupply2, rounds.UP)

            const fumBuyPrice3 = await usmView.fumPrice(sides.BUY)
            fumBuyPrice3.should.be.bignumber.lt(fumBuyPrice2)
            shouldEqualApprox(fumBuyPrice3, targetFumBuyPrice3)
          })

          it("sending Ether to the FUM contract mints (funds) FUM", async () => {
            await web3.eth.sendTransaction({ from: user2, to: fum.address, value: ethPerFund })

            // These checks are crude simplifications of the "with FUM minted at sliding price" checks above:
            const ethPool = await usm.ethPool()
            const targetEthPool = ethPool0.add(ethPerFund)
            shouldEqual(ethPool, targetEthPool)

            const buySellAdj = await usm.buySellAdjustment()
            buySellAdj.should.be.bignumber.gt(buySellAdj0)
            const price = (await usm.latestPrice())[0]
            price.should.be.bignumber.gt(price0)

            const user2FumBalance = await fum.balanceOf(user2)
            user2FumBalance.should.be.bignumber.gt(user2FumBalance0)
            const totalFumSupply = await fum.totalSupply()
            totalFumSupply.should.be.bignumber.gt(totalFumSupply0)
          })

          // ____________________ Minting USM (aka mint()), at sliding price ____________________

          describe("with USM minted at sliding price", () => {
            let ethPoolM, priceM, debtRatioM, user2FumBalanceM, totalFumSupplyM, buySellAdjM, fumBuyPriceM,
                fumSellPriceM, usmBuyPriceM, usmSellPriceM, adjShrinkFactorM

            beforeEach(async () => {
              await usm.mint(user1, 0, { from: user2, value: ethPerMint })

              ethPoolM = await usm.ethPool()                    // "M" suffix = values after this mint() call
              priceM = (await usm.latestPrice())[0]
              debtRatioM = await usmView.debtRatio()
              user1UsmBalanceM = await usm.balanceOf(user1)
              totalUsmSupplyM = await usm.totalSupply()
              buySellAdjM = await usm.buySellAdjustment()
              fumBuyPriceM = await usmView.fumPrice(sides.BUY)
              fumSellPriceM = await usmView.fumPrice(sides.SELL)
              usmBuyPriceM = await usmView.usmPrice(sides.BUY)
              usmSellPriceM = await usmView.usmPrice(sides.SELL)

              adjShrinkFactorM = (fl(ethPool0) / fl(ethPoolM))**0.5
            })

            it("increases ETH pool correctly when minting USM", async () => {
              const targetEthPoolM = ethPool0.add(ethPerMint)
              shouldEqual(ethPoolM, targetEthPoolM)
            })

            it("reduces buySellAdjustment correctly when minting USM", async () => {
              buySellAdjM.should.be.bignumber.lt(buySellAdj0)
              const targetBuySellAdjM = wad(fl(buySellAdj0) * adjShrinkFactorM)
              shouldEqualApprox(buySellAdjM, targetBuySellAdjM)
            })

            it("reduces ETH mid price correctly when minting USM", async () => {
              const targetPriceM = wad(fl(price0) * adjShrinkFactorM)
              shouldEqualApprox(priceM, targetPriceM)
            })

            it("increases USM buy and sell prices correctly when minting USM", async () => {
              const targetUsmBuyPriceM = wad(fl(usmBuyPrice0) / adjShrinkFactorM**2)
              shouldEqualApprox(usmBuyPriceM, targetUsmBuyPriceM)
              const targetUsmSellPriceM = wad(fl(usmSellPrice0) / adjShrinkFactorM)
              shouldEqualApprox(usmSellPriceM, targetUsmSellPriceM)
            })

            it("reduces FUM buy and sell prices when minting USM", async () => {
              // Effect on fumBuyPrice/fumSellPrice is nontrivial: minting reduces ETH mid price, which reduces FUM mid price;
              // but on the other hand, the fees from the mint increase FUM mid price.  So which factor dominates may depend on
              // the amount of fees paid, ie, the size (ETH amount) of the mint() relative to the size of the pool.  But I
              // suspect at least FUM sell price always does end up net decreasing?
              //console.log(fl(fumBuyPrice0) + ", " + fl(fumBuyPriceM) + ", " + fl(fumSellPrice0) + ", " + fl(fumSellPriceM))
              //fumBuyPriceM.should.be.bignumber.lt(fumBuyPrice0)
              fumSellPriceM.should.be.bignumber.lt(fumSellPrice0)
            })

            it("increases USM supply correctly when minting USM", async () => {
              // Math from USMTemplate.usmFromMint():
              const targetUsmOut = wad((fl(ethPool0) / fl(usmBuyPrice0)) * 2 * -Math.log(adjShrinkFactorM))
              const targetTotalUsmSupplyM = totalUsmSupply0.add(targetUsmOut)
              shouldEqualApprox(user1UsmBalanceM, targetTotalUsmSupplyM)
              shouldEqualApprox(totalUsmSupplyM, targetTotalUsmSupplyM)
            })

            it("moves debtRatio towards 100% when minting USM", async () => {
              if (debtRatio0.lt(WAD)) {
                debtRatioM.should.be.bignumber.gt(debtRatio0)
              } else {
                debtRatioM.should.be.bignumber.lt(debtRatio0)
              }
            })
          })

          it("reduces buySellAdjustment when minting while debt ratio > 100%", async () => {
            // Move price to get debt ratio just *above* 100%:
            const targetDebtRatio = WAD.mul(HUNDRED.add(ONE)).div(HUNDRED) // 101%
            const priceChangeFactor = wadDiv(debtRatio0, targetDebtRatio, rounds.UP)
            const targetPrice = wadMul(price0, priceChangeFactor, rounds.DOWN)
            await oracle.setPrice(targetPrice)
            await usm.refreshPrice()
            const price = (await usm.latestPrice())[0]
            shouldEqualApprox(price, targetPrice)

            const debtRatio = await usmView.debtRatio()
            debtRatio.should.be.bignumber.gt(WAD)

            // And now minting should still reduce the adjustment, not increase it:
            const buySellAdj1 = await usm.buySellAdjustment()
            await usm.mint(user1, 0, { from: user2, value: bitOfEth })
            const buySellAdj2 = await usm.buySellAdjustment()
            buySellAdj2.should.be.bignumber.lt(buySellAdj1)
          })

          it("sending Ether to the USM contract mints USM", async () => {
            await web3.eth.sendTransaction({ from: user1, to: usm.address, value: ethPerMint })

            // These checks are all cribbed from the "with USM minted at sliding price" checks above:
            const ethPool = await usm.ethPool()
            const targetEthPool = ethPool0.add(ethPerMint)
            shouldEqual(ethPool, targetEthPool)

            const buySellAdj = await usm.buySellAdjustment()
            const adjShrinkFactor = (fl(ethPool0) / fl(ethPool))**0.5
            const targetBuySellAdj = wad(fl(buySellAdj0) * adjShrinkFactor)
            shouldEqualApprox(buySellAdj, targetBuySellAdj)
            const price = (await usm.latestPrice())[0]
            const targetPrice = wad(fl(price0) * adjShrinkFactor)
            shouldEqualApprox(price, targetPrice)

            const user1UsmBalance = await usm.balanceOf(user1)
            const targetUsmOut = wad((fl(ethPool0) / fl(usmBuyPrice0)) * Math.log(fl(ethPool) / fl(ethPool0)))
            const targetTotalUsmSupply = totalUsmSupply0.add(targetUsmOut)
            shouldEqualApprox(user1UsmBalance, targetTotalUsmSupply)
            const totalUsmSupply = await usm.totalSupply()
            shouldEqualApprox(totalUsmSupply, targetTotalUsmSupply)
          })

          // ____________________ Burning FUM (aka defund()) ____________________

          it("allows burning FUM", async () => {
            const fumToBurn = user2FumBalance0.div(TWO) // defund 50% of the user's FUM
            await usm.defund(user2, user1, fumToBurn, 0, { from: user2 })
          })

          describe("with FUM burned at sliding price", () => {
            let fumToBurn, ethPoolD, priceD, debtRatioD, user2FumBalanceD, totalFumSupplyD, buySellAdjD, fumBuyPriceD,
                fumSellPriceD, usmBuyPriceD, usmSellPriceD, targetEthPoolD, adjShrinkFactorD

            beforeEach(async () => {
              fumToBurn = user2FumBalance0.div(TWO)
              await usm.defund(user2, user1, fumToBurn, 0, { from: user2 })

              ethPoolD = await usm.ethPool()                    // "D" suffix = values after this defund() call
              priceD = (await usm.latestPrice())[0]
              debtRatioD = await usmView.debtRatio()
              user2FumBalanceD = await fum.balanceOf(user2)
              totalFumSupplyD = await fum.totalSupply()
              buySellAdjD = await usm.buySellAdjustment()
              fumBuyPriceD = await usmView.fumPrice(sides.BUY)
              fumSellPriceD = await usmView.fumPrice(sides.SELL)
              usmBuyPriceD = await usmView.usmPrice(sides.BUY)
              usmSellPriceD = await usmView.usmPrice(sides.SELL)

              // See USMTemplate.fumFromFund() for the math we're mirroring here:
              const fumDelta = 1 / (1 - fl(debtRatio0))
              const lowerBoundEthPoolD = fl(ethPool0) - fl(fumToBurn) * fl(fumSellPrice0)
              const lowerBoundAdjShrinkFactor = (lowerBoundEthPoolD / fl(ethPool0))**(fumDelta / 2)
              const lowerBoundPriceF = fl(price0) * lowerBoundAdjShrinkFactor
              const avgFumSellPrice = (fl(ethPool0) - fl(totalUsmSupply0) / lowerBoundPriceF) / fl(totalFumSupply0) *
                Math.min(1, fl(buySellAdj0))
              const ethOut = fl(fumToBurn) * avgFumSellPrice
              targetEthPoolD = wad(fl(ethPool0) - ethOut)
              adjShrinkFactorD = (fl(targetEthPoolD) / fl(ethPool0))**(fumDelta / 2)
            })

            it("reduces FUM supply correctly when burning FUM", async () => {
              const targetTotalFumSupplyD = totalFumSupply0.sub(fumToBurn)
              shouldEqual(user2FumBalanceD, targetTotalFumSupplyD)
              shouldEqual(totalFumSupplyD, targetTotalFumSupplyD)
            })

            it("reduces buySellAdjustment correctly when burning FUM", async () => {
              buySellAdjD.should.be.bignumber.lt(buySellAdj0)
              const targetBuySellAdjD = wad(fl(buySellAdj0) * adjShrinkFactorD)
              shouldEqualApprox(buySellAdjD, targetBuySellAdjD)
            })

            it("reduces ETH mid price correctly when burning FUM", async () => {
              const targetPriceD = wad(fl(price0) * adjShrinkFactorD)
              shouldEqualApprox(priceD, targetPriceD)
            })

            it("reduces FUM buy and sell prices correctly when burning FUM", async () => {
              // Note - this doesn't account for the dr > max case, where minFumBuyPrice becomes active:
              const fumMidPriceD = (fl(ethPoolD) - fl(totalUsmSupply0) / fl(priceD)) / fl(totalFumSupplyD)
              const targetFumBuyPriceD = wad(Math.max(1, fl(buySellAdjD)) * fumMidPriceD)
              shouldEqualApprox(fumBuyPriceD, targetFumBuyPriceD)
              const targetFumSellPriceD = wad(Math.max(0, Math.min(1, fl(buySellAdjD)) * fumMidPriceD))
              shouldEqualApprox(fumSellPriceD, targetFumSellPriceD)
            })

            it("increases USM buy and sell prices when burning FUM", async () => {
              // Burning FUM both 1. pushes ETH mid price down and 2. pushes buySellAdj down.  Both of these are bad for USM
              // buyers/minters (usmBuyPrice up), and good for USM sellers/burners (usmSellPrice up):
              usmBuyPriceD.should.be.bignumber.gt(usmBuyPrice0)
              usmSellPriceD.should.be.bignumber.gt(usmSellPrice0)
            })

            it("reduces ETH pool correctly when burning FUM", async () => {
              // Math from USMTemplate.ethFromDefund():
              shouldEqualApprox(ethPoolD, targetEthPoolD)
            })

            it("increases debtRatio when burning FUM", async () => {
              debtRatioD.should.be.bignumber.gt(debtRatio0)
            })
          })

          it("sending FUM to the FUM contract is a defund", async () => {
            const fumToBurn = user2FumBalance0.div(TWO) // defund 50% of the user's FUM
            await fum.transfer(fum.address, fumToBurn, { from: user2 })

            // These checks are crude simplifications of the "with FUM burned at sliding price" checks above:
            const user2FumBalance = await fum.balanceOf(user2)
            const targetTotalFumSupply = user2FumBalance0.sub(fumToBurn)
            shouldEqual(user2FumBalance, targetTotalFumSupply)
            const totalFumSupply = await fum.totalSupply()
            shouldEqual(totalFumSupply, targetTotalFumSupply)

            const buySellAdj = await usm.buySellAdjustment()
            buySellAdj.should.be.bignumber.lt(buySellAdj0)
            const price = (await usm.latestPrice())[0]
            price.should.be.bignumber.lt(price0)

            const ethPool = await usm.ethPool()
            ethPool.should.be.bignumber.lt(ethPool0)
          })

          it("sending FUM to the USM contract is a defund", async () => {
            const fumToBurn = user2FumBalance0.div(TWO) // defund 50% of the user's FUM
            await fum.transfer(usm.address, fumToBurn, { from: user2 })

            // These checks are crude simplifications of the "with FUM burned at sliding price" checks above:
            const user2FumBalance = await fum.balanceOf(user2)
            const targetTotalFumSupply = user2FumBalance0.sub(fumToBurn)
            shouldEqual(user2FumBalance, targetTotalFumSupply)
            const totalFumSupply = await fum.totalSupply()
            shouldEqual(totalFumSupply, targetTotalFumSupply)

            const buySellAdj = await usm.buySellAdjustment()
            buySellAdj.should.be.bignumber.lt(buySellAdj0)
            const price = (await usm.latestPrice())[0]
            price.should.be.bignumber.lt(price0)

            const ethPool = await usm.ethPool()
            ethPool.should.be.bignumber.lt(ethPool0)
          })

          it("users can opt out of receiving FUM", async () => {
            await expectRevert(fum.transfer(optOut1, 1, { from: user2 }), "Target opted out") // Set in constructor
            await expectRevert(fum.transfer(optOut2, 1, { from: user2 }), "Target opted out") // Set in constructor
            await fum.optOut({ from: user1 })
            await expectRevert(fum.transfer(user1, 1, { from: user2 }), "Target opted out")
          })

          it("users can opt back in to receiving FUM", async () => {
            await fum.optOut({ from: user1 })
            await fum.optBackIn({ from: user1 })
            await fum.transfer(user1, 1, { from: user2 })
          })

          it("doesn't allow burning FUM if it would push debt ratio above MAX_DEBT_RATIO", async () => {
            // Move price to get debt ratio just *below* MAX.  Eg, if debt ratio is currently 156%, increasing the price by
            // (156% / 79%) should bring debt ratio to just about 79%:
            const targetDebtRatio1 = MAX_DEBT_RATIO.sub(WAD.div(HUNDRED)) // Eg, 80% - 1% = 79%
            const priceChangeFactor1 = wadDiv(debtRatio0, targetDebtRatio1, rounds.DOWN)
            const targetPrice1 = wadMul(price0, priceChangeFactor1, rounds.UP)
            await oracle.setPrice(targetPrice1)
            await usm.refreshPrice()
            const price1 = (await usm.latestPrice())[0]
            shouldEqualApprox(price1, targetPrice1)

            const debtRatio1 = await usmView.debtRatio()
            debtRatio1.should.be.bignumber.lt(MAX_DEBT_RATIO)

            // Now this tiny defund() should succeed:
            await usm.defund(user2, user1, oneFum, 0, { from: user2 })

            const debtRatio2 = await usmView.debtRatio()
            // Next, similarly move price to get debt ratio just *above* MAX:
            const targetDebtRatio3 = MAX_DEBT_RATIO.add(WAD.div(HUNDRED)) // Eg, 80% + 1% = 81%
            const priceChangeFactor3 = wadDiv(debtRatio2, targetDebtRatio3, rounds.UP)
            const targetPrice3 = wadMul(price1, priceChangeFactor3, rounds.DOWN)
            await oracle.setPrice(targetPrice3)
            await usm.refreshPrice()
            const price3 = (await usm.latestPrice())[0]
            shouldEqualApprox(price3, targetPrice3)

            const debtRatio3 = await usmView.debtRatio()
            debtRatio3.should.be.bignumber.gt(MAX_DEBT_RATIO)

            // And now defund() should fail:
            await expectRevert(usm.defund(user2, user1, oneFum, 0, { from: user2 }), "Debt ratio > max")
          })

          // ____________________ Burning USM (aka burn()) ____________________

          it("allows burning USM", async () => {
            const usmToBurn = user1UsmBalance0.div(TWO) // defund 50% of the user's USM
            await usm.burn(user1, user2, usmToBurn, 0, { from: user1 })
          })

          describe("with USM burned at sliding price", () => {
            let usmToBurn, priceB, ethPoolB, debtRatioB, user1UsmBalanceB, totalUsmSupplyB, buySellAdjB, fumBuyPriceB,
                fumSellPriceB, usmBuyPriceB, usmSellPriceB, adjGrowthFactorB

            beforeEach(async () => {
              usmToBurn = user1UsmBalance0.div(TWO) // Burning 100% of USM is an esoteric case - instead burn 50%
              await usm.burn(user1, user2, usmToBurn, 0, { from: user1 })

              ethPoolB = await usm.ethPool()                    // "B" suffix = values after this burn() call
              priceB = (await usm.latestPrice())[0]
              debtRatioB = await usmView.debtRatio()
              user1UsmBalanceB = await usm.balanceOf(user1)
              totalUsmSupplyB = await usm.totalSupply()
              buySellAdjB = await usm.buySellAdjustment()
              fumBuyPriceB = await usmView.fumPrice(sides.BUY)
              fumSellPriceB = await usmView.fumPrice(sides.SELL)
              usmBuyPriceB = await usmView.usmPrice(sides.BUY)
              usmSellPriceB = await usmView.usmPrice(sides.SELL)

              adjGrowthFactorB = Math.exp(fl(usmToBurn) * fl(usmSellPrice0) / (2 * fl(ethPool0)))
            })

            it("reduces USM supply correctly when burning USM", async () => {
              const targetTotalUsmSupplyB = totalUsmSupply0.sub(usmToBurn)
              shouldEqual(user1UsmBalanceB, targetTotalUsmSupplyB)
              shouldEqual(totalUsmSupplyB, targetTotalUsmSupplyB)
            })

            it("increases buySellAdjustment correctly when burning USM", async () => {
              buySellAdjB.should.be.bignumber.gt(buySellAdj0)
              const targetBuySellAdjB = wad(fl(buySellAdj0) * adjGrowthFactorB)
              shouldEqualApprox(buySellAdjB, targetBuySellAdjB)
            })

            it("increases ETH mid price correctly when burning USM", async () => {
              const targetPriceB = wad(fl(price0) * adjGrowthFactorB)
              shouldEqualApprox(priceB, targetPriceB)
            })

            it("reduces USM buy and sell prices correctly when burning USM", async () => {
              const targetUsmBuyPriceB = wad(fl(usmBuyPrice0) / adjGrowthFactorB**2)
              shouldEqualApprox(usmBuyPriceB, targetUsmBuyPriceB)
              const targetUsmSellPriceB = wad(fl(usmSellPrice0) / adjGrowthFactorB)
              shouldEqualApprox(usmSellPriceB, targetUsmSellPriceB)
            })

            it("increases FUM buy and sell prices when burning USM", async () => {
              // Effect on fumBuyPrice/fumSellPrice is nontrivial: see corresponding comment for minting USM above.  But I
              // suspect at least fumBuyPrice always does increase?
              fumBuyPriceB.should.be.bignumber.gt(fumBuyPrice0)
              //fumSellPriceB.should.be.bignumber.gt(fumSellPrice0)
            })

            it("reduces ETH pool correctly when burning USM", async () => {
              // Math from USMTemplate.ethFromBurn():
              const targetEthPoolB = wad(fl(ethPool0) / adjGrowthFactorB**2)
              shouldEqualApprox(ethPoolB, targetEthPoolB)
            })

            it("reduces debtRatio when burning USM", async () => {
              debtRatioB.should.be.bignumber.lt(debtRatio0)
            })
          })

          it("sending USM to the USM contract burns it", async () => {
            const usmToBurn = user1UsmBalance0.div(TWO) // defund 50% of the user's USM
            await usm.transfer(usm.address, usmToBurn, { from: user1 })

            // These checks are all cribbed from the "with USM burned at sliding price" checks above:
            const user1UsmBalance = await usm.balanceOf(user1)
            const targetTotalUsmSupply = user1UsmBalance0.sub(usmToBurn)
            shouldEqual(user1UsmBalance, targetTotalUsmSupply)
            const totalUsmSupply = await usm.totalSupply()
            shouldEqual(totalUsmSupply, targetTotalUsmSupply)

            const ethPool = await usm.ethPool()
            const targetEthPool = wad(fl(ethPool0) / Math.exp(fl(usmToBurn) * fl(usmSellPrice0) / fl(ethPool0)))
            shouldEqualApprox(ethPool, targetEthPool)

            const buySellAdj = await usm.buySellAdjustment()
            const adjGrowthFactor = (fl(ethPool0) / fl(ethPool))**0.5
            const targetBuySellAdj = wad(fl(buySellAdj0) * adjGrowthFactor)
            shouldEqualApprox(buySellAdj, targetBuySellAdj)
            const price = (await usm.latestPrice())[0]
            const targetPrice = wad(fl(price0) * adjGrowthFactor)
            shouldEqualApprox(price, targetPrice)
          })

          it("sending USM to the FUM contract burns it", async () => {
            const usmToBurn = user1UsmBalance0.div(TWO) // defund 50% of the user's USM
            await usm.transfer(fum.address, usmToBurn, { from: user1 })

            // These checks are all cribbed from the "with USM burned at sliding price" checks above:
            const user1UsmBalance = await usm.balanceOf(user1)
            const targetTotalUsmSupply = user1UsmBalance0.sub(usmToBurn)
            shouldEqual(user1UsmBalance, targetTotalUsmSupply)
            const totalUsmSupply = await usm.totalSupply()
            shouldEqual(totalUsmSupply, targetTotalUsmSupply)

            const ethPool = await usm.ethPool()
            const targetEthPool = wad(fl(ethPool0) / Math.exp(fl(usmToBurn) * fl(usmSellPrice0) / fl(ethPool0)))
            shouldEqualApprox(ethPool, targetEthPool)

            const buySellAdj = await usm.buySellAdjustment()
            const adjGrowthFactor = (fl(ethPool0) / fl(ethPool))**0.5
            const targetBuySellAdj = wad(fl(buySellAdj0) * adjGrowthFactor)
            shouldEqualApprox(buySellAdj, targetBuySellAdj)
            const price = (await usm.latestPrice())[0]
            const targetPrice = wad(fl(price0) * adjGrowthFactor)
            shouldEqualApprox(price, targetPrice)
          })

          it("users can opt out of receiving USM", async () => {
            await expectRevert(usm.transfer(optOut1, 1, { from: user1 }), "Target opted out") // Set in constructor
            await expectRevert(usm.transfer(optOut2, 1, { from: user1 }), "Target opted out") // Set in constructor
            await usm.optOut({ from: user2 })
            await expectRevert(usm.transfer(user2, user1UsmBalance0, { from: user1 }), "Target opted out")
          })

          it("users can opt back in to receiving USM", async () => {
            await usm.optOut({ from: user2 })
            await usm.optBackIn({ from: user2 })
            await usm.transfer(user2, user1UsmBalance0, { from: user1 })
          })

          it("doesn't allow burning USM if debt ratio over 100%", async () => {
            // Move price to get debt ratio just *below* 100%:
            const targetDebtRatio1 = WAD.mul(HUNDRED.sub(ONE)).div(HUNDRED) // 99%
            const priceChangeFactor1 = wadDiv(debtRatio0, targetDebtRatio1, rounds.DOWN)
            const targetPrice1 = wadMul(price0, priceChangeFactor1, rounds.UP)
            await oracle.setPrice(targetPrice1)
            await usm.refreshPrice()
            const price1 = (await usm.latestPrice())[0]
            shouldEqualApprox(price1, targetPrice1)

            const debtRatio1 = await usmView.debtRatio()
            debtRatio1.should.be.bignumber.lt(WAD)

            // Now this tiny burn() should succeed:
            await usm.burn(user1, user2, oneUsm, 0, { from: user1 })

            // Next, similarly move price to get debt ratio just *above* 100%:
            const debtRatio2 = await usmView.debtRatio()
            const targetDebtRatio3 = WAD.mul(HUNDRED.add(ONE)).div(HUNDRED) // 101%
            const priceChangeFactor3 = wadDiv(debtRatio2, targetDebtRatio3, rounds.UP)
            const targetPrice3 = wadMul(price1, priceChangeFactor3, rounds.DOWN)
            await oracle.setPrice(targetPrice3)
            await usm.refreshPrice()
            const price3 = (await usm.latestPrice())[0]
            shouldEqualApprox(price3, targetPrice3)

            const debtRatio3 = await usmView.debtRatio()
            debtRatio3.should.be.bignumber.gt(WAD)

            // And now the same burn() should fail:
            await expectRevert(usm.burn(user1, user2, oneUsm, 0, { from: user1 }), "Debt ratio > 100%")
          })
        })
      })
    })
  })
})
