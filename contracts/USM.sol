// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

import "erc20permit/contracts/ERC20Permit.sol";
import "./IUSM.sol";
import "./ERC20WithOptOut.sol";
import "./oracles/Oracle.sol";
import "./Address.sol";
import "./Delegable.sol";
import "./WadMath.sol";
import "./FUM.sol";
import "./MinOut.sol";


/**
 * @title USM
 * @author Alberto Cuesta Cañada, Jacob Eliosoff, Alex Roan
 * @notice Concept by Jacob Eliosoff (@jacob-eliosoff).
 *
 * This abstract USM contract must be inherited by a concrete implementation, that also adds an Oracle implementation - eg, by
 * also inheriting a concrete Oracle implementation.  See USM (and MockUSM) for an example.
 *
 * We use this inheritance-based design (rather than the more natural, and frankly normally more correct, composition-based
 * design of storing the Oracle here as a variable), because inheriting the Oracle makes all the latestPrice()/refreshPrice()
 * calls *internal* rather than calls to a separate oracle contract (or multiple contracts) - which leads to a significant
 * saving in gas.
 */
contract USM is IUSM, Oracle, ERC20WithOptOut, Delegable {
    using Address for address payable;
    using WadMath for uint;

    event OracleChanged(address previous, address latest);
    event UnderwaterStatusChanged(bool previous, bool latest);
    event BuySellAdjustmentChanged(uint previous, uint latest);
    event PriceChanged(uint previous, uint latest);

    uint public constant WAD = 10 ** 18;
    uint public constant HALF_WAD = WAD / 2;
    uint public constant BILLION = 10 ** 9;
    uint public constant HALF_BILLION = BILLION / 2;
    uint public constant MAX_DEBT_RATIO = WAD * 8 / 10;                 // 80%
    uint public constant MIN_FUM_BUY_PRICE_HALF_LIFE = 1 days;          // Solidity for 1 * 24 * 60 * 60
    uint public constant BUY_SELL_ADJUSTMENT_HALF_LIFE = 1 minutes;     // Solidity for 1 * 60

    FUM public immutable fum;
    Oracle public immutable oracle0;        // Primary oracle
    Oracle public immutable oracle1;        // Backup oracle
    Oracle public oracle;                   // Currently active oracle (either oracle0 or oracle1)

    struct StoredState {
        uint32 timeSystemWentUnderwater;    // Time at which (we noticed) debt ratio went > MAX, or 0 if it's currently < MAX
        uint32 ethUsdPriceTimestamp;
        uint80 ethUsdPrice;                 // Stored in billionths, not WADs: so 123.456 is stored as 123,456,000,000
        uint32 buySellAdjustmentTimestamp;
        uint80 buySellAdjustment;           // Stored in billionths, not WADs
    }

    struct LoadedState {
        uint timeSystemWentUnderwater;
        uint ethUsdPriceTimestamp;
        uint ethUsdPrice;                   // This one is in WADs, not billionths
        uint buySellAdjustmentTimestamp;
        uint buySellAdjustment;             // WADs, not billionths
        uint ethPool;
        uint usmTotalSupply;
    }

    StoredState public storedState = StoredState({
        timeSystemWentUnderwater: 0, ethUsdPriceTimestamp: 0, ethUsdPrice: 0,
        buySellAdjustmentTimestamp: 0, buySellAdjustment: uint80(BILLION)       // initialize adjustment to 1.0 (scaled by 1b)
    });

    constructor(Oracle oracle0_, Oracle oracle1_, address[] memory optedOut_)
        ERC20WithOptOut("Minimalist USD v1.0", "USM", optedOut_)
    {
        oracle0 = oracle0_;
        oracle1 = oracle1_;
        oracle = oracle0_;
        fum = new FUM(this, optedOut_);
    }

    // ____________________ Admin-only external transactional functions ____________________

    function setOracle(uint oracleIndex) external override {
        // TODO: need to restrict calls to this fn to admins only!
        require(oracleIndex == 0 || oracleIndex == 1, "Invalid oracleIndex");
        Oracle previous = oracle;
        Oracle newOracle = (oracleIndex == 0 ? oracle0 : oracle1);
        require(newOracle != oracle, "New oracle same as old");
        oracle = newOracle;
        emit OracleChanged(address(previous), address(newOracle));
    }

    // ____________________ External transactional functions ____________________

    /**
     * @notice Mint new USM, sending it to the given address, and only if the amount minted >= minUsmOut.  The amount of ETH is
     * passed in as msg.value.
     * @param to address to send the USM to.
     * @param minUsmOut Minimum accepted USM for a successful mint.
     */
    function mint(address to, uint minUsmOut) external payable override returns (uint usmOut) {
        usmOut = _mintUsm(to, minUsmOut);
    }

    /**
     * @dev Burn USM in exchange for ETH.
     * @param from address to deduct the USM from.
     * @param to address to send the ETH to.
     * @param usmToBurn Amount of USM to burn.
     * @param minEthOut Minimum accepted ETH for a successful burn.
     */
    function burn(address from, address payable to, uint usmToBurn, uint minEthOut)
        external override
        onlyHolderOrDelegate(from, "Only holder or delegate")
        returns (uint ethOut)
    {
        ethOut = _burnUsm(from, to, usmToBurn, minEthOut);
    }

    /**
     * @notice Funds the pool with ETH, minting new FUM and sending it to the given address, but only if the amount minted >=
     * minFumOut.  The amount of ETH is passed in as msg.value.
     * @param to address to send the FUM to.
     * @param minFumOut Minimum accepted FUM for a successful fund.
     */
    function fund(address to, uint minFumOut) external payable override returns (uint fumOut) {
        fumOut = _fundFum(to, minFumOut);
    }

    /**
     * @notice Defunds the pool by redeeming FUM in exchange for equivalent ETH from the pool.
     * @param from address to deduct the FUM from.
     * @param to address to send the ETH to.
     * @param fumToBurn Amount of FUM to burn.
     * @param minEthOut Minimum accepted ETH for a successful defund.
     */
    function defund(address from, address payable to, uint fumToBurn, uint minEthOut)
        external override
        onlyHolderOrDelegate(from, "Only holder or delegate")
        returns (uint ethOut)
    {
        ethOut = _defundFum(from, to, fumToBurn, minEthOut);
    }

    /**
     * @notice Defunds the pool by redeeming FUM from an arbitrary address in exchange for equivalent ETH from the pool.
     * Called only by the FUM contract, when FUM is sent to it.
     * @param from address to deduct the FUM from.
     * @param to address to send the ETH to.
     * @param fumToBurn Amount of FUM to burn.
     * @param minEthOut Minimum accepted ETH for a successful defund.
     */
    function defundFromFUM(address from, address payable to, uint fumToBurn, uint minEthOut)
        external override
        returns (uint ethOut)
    {
        require(msg.sender == address(fum), "Restricted to FUM");
        ethOut = _defundFum(from, to, fumToBurn, minEthOut);
    }

    /**
     * @notice If anyone sends ETH here, assume they intend it as a `mint`.
     * If decimals 8 to 11 (included) of the amount of Ether received are `0000` then the next 7 will
     * be parsed as the minimum Ether price accepted, with 2 digits before and 5 digits after the comma.
     */
    receive() external payable {
        _mintUsm(msg.sender, MinOut.parseMinTokenOut(msg.value));
    }

    // ____________________ Public transactional functions ____________________

    function refreshPrice() public virtual override(IUSM, Oracle) returns (uint price, uint updateTime) {
        LoadedState memory ls = loadState();
        bool priceChanged;
        (price, updateTime, ls.buySellAdjustment, priceChanged) = _refreshPrice(ls);
        if (priceChanged) {
            (ls.ethUsdPrice, ls.ethUsdPriceTimestamp) = (price, updateTime);
            _storeState(ls);
        }
    }

    // ____________________ Internal ERC20 transactional functions ____________________

    /**
     * @notice If a user sends USM tokens directly to this contract (or to the FUM contract), assume they intend it as a `burn`.
     * If using `transfer`/`transferFrom` as `burn`, and if decimals 8 to 11 (included) of the amount transferred received
     * are `0000` then the next 7 will be parsed as the maximum USM price accepted, with 5 digits before and 2 digits after the comma.
     */
    function _transfer(address sender, address recipient, uint256 amount) internal override noOptOut(recipient) returns (bool) {
        if (recipient == address(this) || recipient == address(fum) || recipient == address(0)) {
            _burnUsm(sender, payable(sender), amount, MinOut.parseMinEthOut(amount));
        } else {
            super._transfer(sender, recipient, amount);
        }
        return true;
    }

    // ____________________ Internal helper transactional functions (for functions above) ____________________

    function _mintUsm(address to, uint minUsmOut) internal returns (uint usmOut)
    {
        // 1. Load the stored state:
        LoadedState memory ls = loadState();
        ls.ethPool -= msg.value;    // Backing out the ETH just received, which our calculations should ignore

        // 2. Check that fund() has been called first - no minting before funding:
        require(ls.ethPool > 0, "Fund before minting");

        // 3. Refresh the oracle price:
        (ls.ethUsdPrice, ls.ethUsdPriceTimestamp, ls.buySellAdjustment, ) = _refreshPrice(ls);

        // 4. Calculate usmOut:
        uint adjShrinkFactor;
        (usmOut, adjShrinkFactor) = usmFromMint(ls, msg.value);
        require(usmOut >= minUsmOut, "Limit not reached");

        // 5. Update the in-memory LoadedState's buySellAdjustment and price:
        ls.buySellAdjustment = ls.buySellAdjustment.wadMulDown(adjShrinkFactor);
        ls.ethUsdPrice = ls.ethUsdPrice.wadMulDown(adjShrinkFactor);

        // 6. Store the updated state and mint the user's new USM:
        _storeState(ls);
        _mint(to, usmOut);
    }

    function _burnUsm(address from, address payable to, uint usmToBurn, uint minEthOut) internal returns (uint ethOut)
    {
        // 1. Load the stored state:
        LoadedState memory ls = loadState();

        // 2. Refresh the oracle price:
        (ls.ethUsdPrice, ls.ethUsdPriceTimestamp, ls.buySellAdjustment, ) = _refreshPrice(ls);

        // 3. Calculate ethOut:
        uint adjGrowthFactor;
        (ethOut, adjGrowthFactor) = ethFromBurn(ls, usmToBurn);
        require(ethOut >= minEthOut, "Limit not reached");

        // 4. Update the in-memory LoadedState's buySellAdjustment and price:
        ls.buySellAdjustment = ls.buySellAdjustment.wadMulUp(adjGrowthFactor);
        ls.ethUsdPrice = ls.ethUsdPrice.wadMulUp(adjGrowthFactor);

        // 5. Check that the burn didn't leave debt ratio > 100%:
        uint newDebtRatio = debtRatio(ls.ethUsdPrice, ls.ethPool - ethOut, ls.usmTotalSupply - usmToBurn);
        require(newDebtRatio <= WAD, "Debt ratio > 100%");

        // 6. Burn the input USM, store the updated state, and return the user's ETH:
        _burn(from, usmToBurn);
        _storeState(ls);
        to.sendValue(ethOut);
    }

    function _fundFum(address to, uint minFumOut) internal returns (uint fumOut)
    {
        // 1. Load the stored state:
        LoadedState memory ls = loadState();
        ls.ethPool -= msg.value;    // Backing out the ETH just received, which our calculations should ignore

        // 2. Refresh the oracle price:
        (ls.ethUsdPrice, ls.ethUsdPriceTimestamp, ls.buySellAdjustment, ) = _refreshPrice(ls);

        // 3. Refresh timeSystemWentUnderwater:
        uint usmSupplyForFumBuy;
        (ls.timeSystemWentUnderwater, usmSupplyForFumBuy) =
            checkIfUnderwater(ls.usmTotalSupply, ls.ethPool, ls.ethUsdPrice, ls.timeSystemWentUnderwater);

        // 4. Calculate fumOut:
        uint fumSupply = fum.totalSupply();
        uint adjGrowthFactor;
        (fumOut, adjGrowthFactor) = fumFromFund(ls, usmSupplyForFumBuy, fumSupply, msg.value);
        require(fumOut >= minFumOut, "Limit not reached");

        // 5. Update the in-memory LoadedState's buySellAdjustment and price:
        ls.buySellAdjustment = ls.buySellAdjustment.wadMulUp(adjGrowthFactor);
        ls.ethUsdPrice = ls.ethUsdPrice.wadMulUp(adjGrowthFactor);

        // 6. Update the stored state and mint the user's new FUM:
        _storeState(ls);
        fum.mint(to, fumOut);
    }

    function _defundFum(address from, address payable to, uint fumToBurn, uint minEthOut) internal returns (uint ethOut)
    {
        // 1. Load the stored state:
        LoadedState memory ls = loadState();

        // 2. Refresh the oracle price:
        (ls.ethUsdPrice, ls.ethUsdPriceTimestamp, ls.buySellAdjustment, ) = _refreshPrice(ls);

        // 3. Calculate ethOut:
        uint fumSupply = fum.totalSupply();
        uint adjShrinkFactor;
        (ethOut, adjShrinkFactor) = ethFromDefund(ls, fumSupply, fumToBurn);
        require(ethOut >= minEthOut, "Limit not reached");

        // 4. Update the in-memory LoadedState's buySellAdjustment and price:
        ls.buySellAdjustment = ls.buySellAdjustment.wadMulDown(adjShrinkFactor);
        ls.ethUsdPrice = ls.ethUsdPrice.wadMulDown(adjShrinkFactor);

        // 5. Check that the defund didn't leave debt ratio > MAX_DEBT_RATIO:
        uint newDebtRatio = debtRatio(ls.ethUsdPrice, ls.ethPool - ethOut, ls.usmTotalSupply);
        require(newDebtRatio <= MAX_DEBT_RATIO, "Debt ratio > max");

        // 6. Burn the input FUM, store the updated state, and return the user's ETH:
        fum.burn(from, fumToBurn);
        _storeState(ls);
        to.sendValue(ethOut);
    }

    function _refreshPrice(LoadedState memory ls)
        internal returns (uint price, uint updateTime, uint adjustment, bool priceChanged)
    {
        (price, updateTime) = oracle.refreshPrice();

        // The rest of this fn should be non-transactional: only the oracle.refreshPrice() call above may affect storage.
        adjustment = ls.buySellAdjustment;
        priceChanged = updateTime > ls.ethUsdPriceTimestamp;

        if (!priceChanged) {                // If the price isn't fresher than our old one, scrap it and stick to the old one
            (price, updateTime) = (ls.ethUsdPrice, ls.ethUsdPriceTimestamp);
        } else if (ls.ethUsdPrice != 0) {   // If the old price is 0, don't try to use it to adjust the buySellAdjustment...
            /**
             * This is a bit subtle.  We want to update the mid stored price to the oracle's fresh value, while updating
             * buySellAdjustment in such a way that the currently adjusted (more expensive than mid) side gets no
             * cheaper/more favorably priced for users.  Example:
             *
             * 1. storedPrice = $1,000, and buySellAdjustment = 1.02.  So, our current ETH buy price is $1,020, and our current
             *    ETH sell price is $1,000 (mid).
             * 2. The oracle comes back with a fresh price (newer updateTime) of $990.
             * 3. The currently adjusted price is buy price (ie, adj > 1).  So, we want to:
             *    a) Update storedPrice (mid) to $990.
             *    b) Update buySellAdj to ensure that buy price remains >= $1,020.
             * 4. We do this by upping buySellAdj 1.02 -> 1.0303.  Then the new buy price will remain $990 * 1.0303 = $1,020.
             *    The sell price will remain the unadjusted mid: formerly $1,000, now $990.
             *
             * Because the buySellAdjustment reverts to 1 in a few minutes, the new 3.03% buy premium is temporary: buy price
             * will revert to the $990 mid soon - unless the new mid is egregiously low, in which case buyers should push it
             * back up.  Eg, suppose the oracle gives us a glitchy price of $99.  Then new mid = $99, buySellAdj = 10.303, buy
             * price = $1,020, and the buy price will rapidly drop towards $99; but as it does so, users are incentivized to
             * step in and buy, eventually pushing mid back up to the real-world ETH market price (eg $990).
             *
             * In cases like this, our buySellAdj update has protected the system, by preventing users from getting any chance
             * to buy at the bogus $99 price.
             */
            if (adjustment > WAD) {
                // max(1, old buy price / new mid price):
                adjustment = WAD.wadMax(ls.ethUsdPrice * adjustment / price);
            } else if (adjustment < WAD) {
                // min(1, old sell price / new mid price):
                adjustment = WAD.wadMin(ls.ethUsdPrice * adjustment / price);
            }
        }
    }

    /**
     * @notice Stores the current price, `buySellAdjustment`, and `timeSystemWentUnderwater`.  Note that whereas most calls
     * to this function store a fresh `buySellAdjustmentTimestamp`, most calls do *not* store a fresh `ethUsdPriceTimestamp`:
     * the latter isn't updated every time this is called with a new price, but only when the *oracle's* price is refreshed.
     * The oracle price being "refreshed" is itself a subtle idea: see the comment in `OurUniswapV2TWAPOracle._latestPrice()`.
     */
    function _storeState(LoadedState memory ls) internal {
        uint previousTimeUnderwater = storedState.timeSystemWentUnderwater;
        require(ls.timeSystemWentUnderwater <= type(uint32).max, "timeSystemWentUnderwater overflow");
        emit PriceChanged(previousTimeUnderwater, ls.timeSystemWentUnderwater);

        require(ls.ethUsdPriceTimestamp <= type(uint32).max, "ethUsdPriceTimestamp overflow");

        uint previousPrice = storedState.ethUsdPrice * BILLION;
        uint priceToStore = ls.ethUsdPrice + HALF_BILLION;
        unchecked { priceToStore /= BILLION; }
        require(priceToStore <= type(uint80).max, "ethUsdPrice overflow");
        emit PriceChanged(previousPrice, ls.ethUsdPrice);

        require(ls.buySellAdjustmentTimestamp <= type(uint32).max, "buySellAdjustmentTimestamp overflow");

        uint previousAdjustment = storedState.buySellAdjustment * BILLION;
        uint adjustmentToStore = ls.buySellAdjustment + HALF_BILLION;
        unchecked { adjustmentToStore /= BILLION; }
        require(adjustmentToStore <= type(uint80).max, "buySellAdjustment overflow");
        emit BuySellAdjustmentChanged(previousAdjustment, ls.buySellAdjustment);

        (storedState.timeSystemWentUnderwater,
         storedState.ethUsdPriceTimestamp, storedState.ethUsdPrice,
         storedState.buySellAdjustmentTimestamp, storedState.buySellAdjustment) =
            (uint32(ls.timeSystemWentUnderwater),
             uint32(ls.ethUsdPriceTimestamp), uint80(priceToStore),
             uint32(ls.buySellAdjustmentTimestamp), uint80(adjustmentToStore));
    }

    // ____________________ Public Oracle view functions ____________________

    function latestPrice() public virtual override(IUSM, Oracle) view returns (uint price, uint updateTime) {
        (price, updateTime) = (storedState.ethUsdPrice * BILLION, storedState.ethUsdPriceTimestamp);
    }

    // ____________________ Public informational view functions ____________________

    function latestOraclePrice() public virtual override view returns (uint price, uint updateTime) {
        (price, updateTime) = oracle.latestPrice();
    }

    /**
     * @notice Total amount of ETH in the pool (ie, in the contract).
     * @return pool ETH pool
     */
    function ethPool() public override view returns (uint pool) {
        pool = address(this).balance;
    }

    function usmTotalSupply() public override view returns (uint supply) {
        supply = totalSupply();
    }

    function fumTotalSupply() public override view returns (uint supply) {
        supply = fum.totalSupply();
    }

    /**
     * @notice The current buy/sell adjustment, equal to the stored value decayed over time towards its stable value, 1.  This
     * adjustment is intended as a measure of "how long-ETH recent user activity has been", so that we can slide price
     * accordingly: if recent activity was mostly long-ETH (fund() and burn()), raise FUM buy price/reduce USM sell price; if
     * recent activity was short-ETH (defund() and mint()), reduce FUM sell price/raise USM buy price.
     * @return adjustment The sliding-price buy/sell adjustment
     */
    function buySellAdjustment() public override view returns (uint adjustment) {
        adjustment = loadState().buySellAdjustment;
    }

    /**
     * @return timeSystemWentUnderwater_ 0 the time at which we first detected the system was underwater (debt ratio >
     * MAX_DEBT_RATIO), based on the current oracle price and pool ETH and USM; or 0 if we're not currently underwater.
     * @return usmSupplyForFumBuys The current supply of USM *for purposes of calculating the FUM buy price,* and therefore
     * for `fumFromFund()`.  The "supply for FUM buys" is the *lesser* of the actual current USM supply, and the USM amount
     * that would make debt ratio = MAX_DEBT_RATIO.  Example:
     *
     * 1. Suppose the system currently contains 50 ETH at price $1,000 (total pool value: $50,000), with an actual USM supply
     *    of 30,000 USM.  Then debt ratio = 30,000 / $50,000 = 60%: < MAX 80%, so `usmSupplyForFumBuys` = 30,000.
     * 2. Now suppose ETH/USD halves to $500.  Then pool value halves to $25,000, and debt ratio doubles to 120%.  Now
     *    `usmSupplyForFumBuys` instead = 20,000: the USM quantity at which debt ratio would equal 80% (20,000 / $25,000).
     *    (Call this the "80% supply".)
     * 3. ...Except, we also gradually increase the supply over time while we remain underwater.  This has the effect of
     *    *reducing* the FUM buy price inferred from that supply (higher JacobUSM supply -> smaller buffer -> lower FUM price).
     *    The math we use gradually increases the supply from its initial "80% supply" value, where debt ratio = MAX_DEBT_RATIO
     *    (20,000 above), to a theoretical maximum "100% supply" value, where debt ratio = 100% (in the $500 example above,
     *    this would be 25,000).  (Or the actual supply, whichever is lower: we never increase `usmSupplyForFumBuys` above
     *    `usmActualSupply`.)  The climb from the initial 80% supply (20,000) to the 100% supply (25,000) is at a rate that
     *    brings it "halfway closer per MIN_FUM_BUY_PRICE_HALF_LIFE (eg, 1 day)": so three days after going underwater, the
     *    supply returned will be 25,000 - 0.5**3 * (25,000 - 20,000) = 24,375.
     */
    function checkIfUnderwater(uint usmActualSupply, uint ethPool_, uint ethUsdPrice, uint oldTimeUnderwater)
        public override view returns (uint timeSystemWentUnderwater_, uint usmSupplyForFumBuys)
    {
        uint debtRatio_ = debtRatio(ethUsdPrice, ethPool_, usmActualSupply);
        if (debtRatio_ <= MAX_DEBT_RATIO) {            // We're not underwater, so leave timeSystemWentUnderwater_ as 0
            usmSupplyForFumBuys = usmActualSupply;     // When not underwater, USM supply for FUM buys is just actual supply
        } else {                                       // We're underwater
            // Set timeSystemWentUnderwater_ to block.timestamp, if it wasn't already set:
            timeSystemWentUnderwater_ = (oldTimeUnderwater != 0 ? oldTimeUnderwater : block.timestamp);

            // Calculate usmSupplyForFumBuys:
            uint maxEffectiveDebtRatio = debtRatio_.wadMin(WAD);    // min(actual debt ratio, 100%)
            uint numHalvings = (block.timestamp - timeSystemWentUnderwater_).wadDivDown(MIN_FUM_BUY_PRICE_HALF_LIFE);
            uint decayFactor = numHalvings.wadHalfExp();
            uint effectiveDebtRatio = maxEffectiveDebtRatio - decayFactor.wadMulUp(maxEffectiveDebtRatio - MAX_DEBT_RATIO);
            usmSupplyForFumBuys = effectiveDebtRatio.wadMulDown(ethPool_.wadMulDown(ethUsdPrice));
        }
    }

    function timeSystemWentUnderwater() public override view returns (uint timestamp) {
        timestamp = storedState.timeSystemWentUnderwater;
    }

    // ____________________ Public helper view functions (for functions above) ____________________

    function loadState() public view returns (LoadedState memory ls) {
        ls.timeSystemWentUnderwater = storedState.timeSystemWentUnderwater;
        ls.ethUsdPriceTimestamp = storedState.ethUsdPriceTimestamp;
        ls.ethUsdPrice = storedState.ethUsdPrice * BILLION;     // Converting stored BILLION (10**9) format to WAD (10**18)
        ls.buySellAdjustmentTimestamp = block.timestamp;   // Bring buySellAdjustment from its stored time to the present: it gravitates -> 1 over time
        ls.buySellAdjustment = buySellAdjustment(storedState.buySellAdjustmentTimestamp,
                                                 storedState.buySellAdjustment * BILLION,
                                                 block.timestamp);
        ls.ethPool = ethPool();
        ls.usmTotalSupply = totalSupply();
    }

    // ____________________ Public helper pure functions (for functions above) ____________________

    /**
     * @notice Calculate the amount of ETH in the buffer.
     * @return buffer ETH buffer
     */
    function ethBuffer(uint ethUsdPrice, uint ethInPool, uint usmSupply, WadMath.Round upOrDown)
        public override pure returns (int buffer)
    {
        // Reverse the input upOrDown, since we're using it for usmToEth(), which will be *subtracted* from ethInPool below:
        WadMath.Round downOrUp = (upOrDown == WadMath.Round.Down ? WadMath.Round.Up : WadMath.Round.Down);
        buffer = int(ethInPool) - int(usmToEth(ethUsdPrice, usmSupply, downOrUp));
        require(buffer <= int(ethInPool), "Underflow error");
    }

    /**
     * @notice Calculate debt ratio for a given eth to USM price: ratio of the outstanding USM (amount of USM in total supply), to
     * the current ETH pool value in USD (ETH qty * ETH/USD price).
     * @return ratio Debt ratio
     */
    function debtRatio(uint ethUsdPrice, uint ethInPool, uint usmSupply) public override pure returns (uint ratio) {
        uint ethPoolValueInUsd = ethInPool.wadMulDown(ethUsdPrice);
        ratio = (ethPoolValueInUsd == 0 ? 0 : usmSupply.wadDivUp(ethPoolValueInUsd));
    }

    /**
     * @notice Convert ETH amount to USM using a ETH/USD price.
     * @param ethAmount The amount of ETH to convert
     * @return usmOut The amount of USM
     */
    function ethToUsm(uint ethUsdPrice, uint ethAmount, WadMath.Round upOrDown) public override pure returns (uint usmOut) {
        usmOut = ethAmount.wadMul(ethUsdPrice, upOrDown);
    }

    /**
     * @notice Convert USM amount to ETH using a ETH/USD price.
     * @param usmAmount The amount of USM to convert
     * @return ethOut The amount of ETH
     */
    function usmToEth(uint ethUsdPrice, uint usmAmount, WadMath.Round upOrDown) public override pure returns (uint ethOut) {
        ethOut = usmAmount.wadDiv(ethUsdPrice, upOrDown);
    }

    /**
     * @notice Calculate the *marginal* price of USM (in ETH terms) - that is, of the next unit, before the price start sliding.
     * @return price USM price in ETH terms
     */
    function usmPrice(IUSM.Side side, uint ethUsdPrice, uint adjustment) public override pure returns (uint price) {
        WadMath.Round upOrDown = (side == IUSM.Side.Buy ? WadMath.Round.Up : WadMath.Round.Down);
        price = usmToEth(ethUsdPrice, WAD, upOrDown);

        if ((side == IUSM.Side.Buy && adjustment < WAD) || (side == IUSM.Side.Sell && adjustment > WAD)) {
            price = price.wadDiv(adjustment, upOrDown);
        }
    }

    /**
     * @notice Calculate the *marginal* price of FUM (in ETH terms): that is, of the next unit, before the price start sliding.
     * @param usmEffectiveSupply should be either the actual current USM supply, or, when calculating the FUM *buy* price, the
     * `usmSupplyForFumBuys` return value from `checkIfUnderwater()`.
     * @return price FUM price in ETH terms
     */
    function fumPrice(IUSM.Side side, uint ethUsdPrice, uint ethInPool, uint usmEffectiveSupply, uint fumSupply,
                      uint adjustment)
        public override pure returns (uint price)
    {
        WadMath.Round upOrDown = (side == IUSM.Side.Buy ? WadMath.Round.Up : WadMath.Round.Down);
        if (fumSupply == 0) {
            return usmToEth(ethUsdPrice, WAD, upOrDown);    // if no FUM issued yet, default fumPrice to 1 USD (in ETH terms)
        }

        // Using usmEffectiveSupply here, rather than just the raw actual supply, has the effect of bumping the FUM price up to
        // the minFumBuyPrice when needed (ie, debt ratio > MAX_DEBT_RATIO):
        int buffer = ethBuffer(ethUsdPrice, ethInPool, usmEffectiveSupply, upOrDown);
        price = (buffer <= 0 ? 0 : uint(buffer).wadDiv(fumSupply, upOrDown));

        if (side == IUSM.Side.Buy) {
            if (adjustment > WAD) {
                price = price.wadMulUp(adjustment);
            }
        } else if (adjustment < WAD) {
            price = price.wadMulDown(adjustment);
        }
    }

    /**
     * @notice Returns the given stored buySellAdjustment value, updated (decayed towards 1) to the current time.
     */
    function buySellAdjustment(uint storedTime, uint storedAdjustment, uint currentTime) public pure returns (uint adjustment)
    {
        uint numHalvings = (currentTime - storedTime).wadDivDown(BUY_SELL_ADJUSTMENT_HALF_LIFE);
        uint decayFactor = numHalvings.wadHalfExp(10);
        // Here we use the idea that for any b and 0 <= p <= 1, we can crudely approximate b**p by 1 + (b-1)p = 1 + bp - p.
        // Eg: 0.6**0.5 pulls 0.6 "about halfway" to 1 (0.8); 0.6**0.25 pulls 0.6 "about 3/4 of the way" to 1 (0.9).
        // So b**p =~ b + (1-p)(1-b) = b + 1 - b - p + bp = 1 + bp - p.
        // (Don't calculate it as 1 + (b-1)p because we're using uints, b-1 can be negative!)
        adjustment = WAD + storedAdjustment.wadMulDown(decayFactor) - decayFactor;
    }

    /**
     * @notice How much USM a minter currently gets back for ethIn ETH, accounting for adjustment and sliding prices.
     * @param ethIn The amount of ETH passed to mint()
     * @return usmOut The amount of USM to receive in exchange
     */
    function usmFromMint(LoadedState memory ls, uint ethIn)
        public pure returns (uint usmOut, uint adjShrinkFactor)
    {
        // Create USM at a sliding-up USM price (ie, a sliding-down ETH price):
        uint usmBuyPrice0 = usmPrice(IUSM.Side.Buy, ls.ethUsdPrice, ls.buySellAdjustment);
        uint ethPool1 = ls.ethPool + ethIn;
        //adjShrinkFactor = ls.ethPool.wadDivDown(ethPool1).wadSqrt();      // Another possible function we could use (same result)
        adjShrinkFactor = ls.ethPool.wadDivDown(ethPool1).wadExp(HALF_WAD);
        int log = ethPool1.wadDivDown(ls.ethPool).wadLog();
        require(log >= 0, "log underflow");
        usmOut = ls.ethPool.wadDivDown(usmBuyPrice0).wadMulDown(uint(log));
    }

    /**
     * @notice How much ETH a burner currently gets from burning usmIn USM, accounting for adjustment and sliding prices.
     * @param usmIn The amount of USM passed to burn()
     * @return ethOut The amount of ETH to receive in exchange
     */
    function ethFromBurn(LoadedState memory ls, uint usmIn)
        public pure returns (uint ethOut, uint adjGrowthFactor)
    {
        // Burn USM at a sliding-down USM price (ie, a sliding-up ETH price):
        uint usmSellPrice0 = usmPrice(IUSM.Side.Sell, ls.ethUsdPrice, ls.buySellAdjustment);

        // Math: this is an integral - sum of all USM burned at a sliding price.
        uint exponent = usmIn.wadMulUp(usmSellPrice0).wadDivUp(ls.ethPool);
        require(exponent <= uint(type(int).max), "exponent overflow");
        uint ethPool1 = ls.ethPool.wadDivUp(exponent.wadExp());
        ethOut = ls.ethPool - ethPool1;
        adjGrowthFactor = ls.ethPool.wadDivUp(ethPool1).wadExp(HALF_WAD);
    }

    /**
     * @notice How much FUM a funder currently gets back for ethIn ETH, accounting for adjustment and sliding prices.
     * @param ethIn The amount of ETH passed to fund()
     * @return fumOut The amount of FUM to receive in exchange
     */
    function fumFromFund(LoadedState memory ls, uint usmEffectiveSupply, uint fumSupply, uint ethIn)
        public pure returns (uint fumOut, uint adjGrowthFactor)
    {
        if (ls.ethPool == 0) {
            // No ETH in the system yet, which breaks our adjGrowthFactor calculation below - skip sliding-prices this time:
            adjGrowthFactor = WAD;
            uint fumBuyPrice0 = fumPrice(IUSM.Side.Buy, ls.ethUsdPrice, ls.ethPool, usmEffectiveSupply, fumSupply,
                                         ls.buySellAdjustment);
            fumOut = ethIn.wadDivDown(fumBuyPrice0);
        } else {
            // Create FUM at a sliding-up FUM price:
            uint ethPool1 = ls.ethPool + ethIn;
            uint effectiveDebtRatio = debtRatio(ls.ethUsdPrice, ls.ethPool, usmEffectiveSupply);
            uint effectiveFumDelta = WAD.wadDivUp(WAD - effectiveDebtRatio);
            adjGrowthFactor = ethPool1.wadDivUp(ls.ethPool).wadExp(effectiveFumDelta / 2);
            uint ethUsdPrice1 = ls.ethUsdPrice.wadMulUp(adjGrowthFactor);
            uint avgFumBuyPrice = ls.buySellAdjustment.wadMulUp(
                (ls.ethPool - usmEffectiveSupply.wadDivDown(ethUsdPrice1)).wadDivUp(fumSupply));
            fumOut = ethIn.wadDivDown(avgFumBuyPrice);
        }
    }

    /**
     * @notice How much ETH a defunder currently gets back for fumIn FUM, accounting for adjustment and sliding prices.
     * @param fumIn The amount of FUM passed to defund()
     * @return ethOut The amount of ETH to receive in exchange
     */
    function ethFromDefund(LoadedState memory ls, uint fumSupply, uint fumIn)
        public pure returns (uint ethOut, uint adjShrinkFactor)
    {
        // Burn FUM at a sliding-down FUM price:
        //uint debtRatio0 = debtRatio(ls.ethUsdPrice, ls.ethPool, ls.usmTotalSupply);
        //uint fumDelta = WAD.wadDivUp(WAD - debtRatio0);
        uint fumDelta = WAD.wadDivUp(WAD - debtRatio(ls.ethUsdPrice, ls.ethPool, ls.usmTotalSupply));

        uint fumSellPrice0 = fumPrice(IUSM.Side.Sell, ls.ethUsdPrice, ls.ethPool, ls.usmTotalSupply, fumSupply,
                                      ls.buySellAdjustment);

        // First obtain a pessimistic upper bound on how large the adjShrinkFactor could be - pessimistic since the more the
        // adjustment shrinks, the more our sell price slides (down) away from us.  The more the ETH pool decreases, the more
        // the adjShrinkFactor drops.  And the amount by which the ETH pool would drop if our entire defund was at the starting
        // fumSellPrice0, is an upper bound on how much the pool could shrink.  Therefore, the adjShrinkFactor implied by that
        // maximum ETH pool reduction, is an upper bound on the actual adjShrinkFactor of this defund() call:
        //uint lowerBoundEthQty1 = ls.ethPool - fumIn.wadMulUp(fumSellPrice0);
        //uint lowerBoundAdjShrinkFactor = lowerBoundEthQty1.wadDivDown(ls.ethPool).wadExp(fumDelta / 2);
        uint lowerBoundAdjShrinkFactor = (ls.ethPool - fumIn.wadMulUp(fumSellPrice0)).wadDivDown(ls.ethPool).wadExp(
            fumDelta / 2);
        uint lowerBoundEthUsdPrice1 = ls.ethUsdPrice.wadMulDown(lowerBoundAdjShrinkFactor);

        // Using this ending ETH mid price lowerBoundEthUsdPrice1, we can calc the actual average FUM sell price of the defund:
        uint avgFumSellPrice = fumPrice(IUSM.Side.Sell, lowerBoundEthUsdPrice1, ls.ethPool, ls.usmTotalSupply, fumSupply,
                                        ls.buySellAdjustment);

        ethOut = fumIn.wadMulDown(avgFumSellPrice);
        uint ethPool1 = ls.ethPool - ethOut;
        adjShrinkFactor = ethPool1.wadDivUp(ls.ethPool).wadExp(fumDelta / 2);
    }
}
