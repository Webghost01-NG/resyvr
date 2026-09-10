// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title IssuerTokenV2
/// @notice Isolated issuer token with controller-only mint and escrow burn.
contract IssuerTokenV2 is ERC20 {
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

    /// @notice Burns tokens already escrowed at the controller address.
    function burnEscrowed(uint256 amount) external {
        if (msg.sender != controller) revert OnlyController();
        _burn(controller, amount);
    }
}
