// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

import "./WadMath.sol";

abstract contract IUSM {
    enum Side {Buy, Sell}

    function setOracle(uint oracleIndex) external virtual;

    function mint(address to, uint minUsmOut) external virtual payable returns (uint);
    function burn(address from, address payable to, uint usmToBurn, uint minEthOut) external virtual returns (uint);
    function fund(address to, uint minFumOut) external virtual payable returns (uint);
    function defund(address from, address payable to, uint fumToBurn, uint minEthOut) external virtual returns (uint);
    function defundFromFUM(address from, address payable to, uint fumToBurn, uint minEthOut) external virtual returns (uint);

    function refreshPrice() public virtual returns (uint price, uint updateTime);

    function latestPrice() public virtual view returns (uint price, uint updateTime);
    function latestOraclePrice() public virtual view returns (uint price, uint updateTime);
    function ethPool() public virtual view returns (uint pool);
    function usmTotalSupply() public virtual view returns (uint supply);    // Is there a way to scrap this and just use ERC20(Permit)'s totalSupply()?
    function fumTotalSupply() public virtual view returns (uint supply);
    function buySellAdjustment() public virtual view returns (uint adjustment);
    function checkIfUnderwater(uint usmActualSupply, uint ethPool_, uint ethUsdPrice, uint oldTimeUnderwater) public virtual view returns (uint timeSystemWentUnderwater_, uint usmSupplyForFumBuys);
    function timeSystemWentUnderwater() public virtual view returns (uint timestamp);

    function ethBuffer(uint ethUsdPrice, uint ethInPool, uint usmSupply, WadMath.Round upOrDown) public virtual pure returns (int buffer);
    function debtRatio(uint ethUsdPrice, uint ethInPool, uint usmSupply) public virtual pure returns (uint ratio);
    function ethToUsm(uint ethUsdPrice, uint ethAmount, WadMath.Round upOrDown) public virtual pure returns (uint usmOut);
    function usmToEth(uint ethUsdPrice, uint usmAmount, WadMath.Round upOrDown) public virtual pure returns (uint ethOut);
    function usmPrice(Side side, uint ethUsdPrice, uint debtRatio_) public virtual pure returns (uint price);
    function fumPrice(Side side, uint ethUsdPrice, uint ethInPool, uint usmEffectiveSupply, uint fumSupply, uint adjustment) public virtual pure returns (uint price);
}
