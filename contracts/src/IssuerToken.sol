// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title IssuerToken
/// @notice Isolated reserve token minted only by its proof controller.
contract IssuerToken is ERC20 {
    error InvalidTokenConfiguration();
    error OnlyController();

    address public immutable controller;
    uint8 private immutable tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0 || decimals_ > 18) {
            revert InvalidTokenConfiguration();
        }
        controller = msg.sender;
        tokenDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }

    function mint(address beneficiary, uint256 amount) external {
        if (msg.sender != controller) revert OnlyController();
        _mint(beneficiary, amount);
    }
}
