// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20Reserve {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title SourceReserveVault
/// @notice Locks one reserve asset and emits deposits that can be proven on Creditcoin.
/// @dev The MVP deliberately exposes no withdrawal function. Redemption is a later,
///      separately reviewed protocol because Attestcoin verification is one-way into Creditcoin.
contract SourceReserveVault {
    error DepositIdAlreadyUsed(bytes32 depositId);
    error InvalidBeneficiary();
    error InvalidDepositId();
    error InvalidIssuerId();
    error InvalidReserveAsset();
    error ReentrantCall();
    error ReserveAmountMismatch(uint256 expected, uint256 received);
    error TransferFromFailed();
    error ZeroAmount();

    IERC20Reserve public immutable reserveAsset;
    bytes32 public immutable issuerId;

    uint256 public totalDeposited;
    mapping(bytes32 depositId => bool used) public usedDepositIds;

    bool private entered;

    event ReserveDeposited(
        bytes32 indexed issuerId,
        bytes32 indexed depositId,
        address indexed beneficiary,
        address depositor,
        uint256 amount
    );

    constructor(address reserveAsset_, bytes32 issuerId_) {
        if (reserveAsset_ == address(0) || reserveAsset_.code.length == 0) revert InvalidReserveAsset();
        if (issuerId_ == bytes32(0)) revert InvalidIssuerId();

        reserveAsset = IERC20Reserve(reserveAsset_);
        issuerId = issuerId_;
    }

    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

    /// @notice Deposit reserve for a Creditcoin beneficiary.
    /// @param depositId Globally unique business identifier consumed on both chains.
    /// @param beneficiary Address that receives the destination token after proof verification.
    /// @param amount Exact reserve amount to lock, in the reserve asset's native decimals.
    function deposit(bytes32 depositId, address beneficiary, uint256 amount) external nonReentrant {
        if (depositId == bytes32(0)) revert InvalidDepositId();
        if (beneficiary == address(0)) revert InvalidBeneficiary();
        if (amount == 0) revert ZeroAmount();
        if (usedDepositIds[depositId]) revert DepositIdAlreadyUsed(depositId);

        usedDepositIds[depositId] = true;

        uint256 balanceBefore = reserveAsset.balanceOf(address(this));
        _safeTransferFrom(address(reserveAsset), msg.sender, address(this), amount);
        uint256 balanceAfter = reserveAsset.balanceOf(address(this));
        uint256 received = balanceAfter >= balanceBefore ? balanceAfter - balanceBefore : 0;

        if (received != amount) revert ReserveAmountMismatch(amount, received);

        totalDeposited += amount;
        emit ReserveDeposited(issuerId, depositId, beneficiary, msg.sender, amount);
    }

    /// @notice Actual token balance, including direct transfers that are not recognized deposits.
    function reserveBalance() external view returns (uint256) {
        return reserveAsset.balanceOf(address(this));
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool success, bytes memory returnData) =
            token.call(abi.encodeCall(IERC20Reserve.transferFrom, (from, to, amount)));

        if (!success) revert TransferFromFailed();
        if (returnData.length == 0) return;
        if (returnData.length != 32 || !abi.decode(returnData, (bool))) revert TransferFromFailed();
    }
}
