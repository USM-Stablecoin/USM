// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.6.7;

interface IMakerPriceFeed {
    function read() external view returns (bytes32);
}