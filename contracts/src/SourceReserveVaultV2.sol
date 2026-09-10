// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20ReserveV2 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title SourceReserveVaultV2
/// @notice Locks one reserve asset and permits only identified issuer-authorized redemptions.
contract SourceReserveVaultV2 {
    error DepositIdAlreadyUsed(bytes32 depositId);
    error InsufficientRecognizedReserve(uint256 available, uint256 requested);
    error InvalidAdministrator();
    error InvalidBeneficiary();
    error InvalidDepositId();
    error InvalidIssuerId();
    error InvalidRecipient();
    error InvalidRedemptionId();
    error InvalidReserveAsset();
    error OnlyAdministrator();
    error RedemptionIdAlreadyUsed(bytes32 redemptionId);
    error ReentrantCall();
    error ReserveAmountMismatch(uint256 expected, uint256 received);
    error TransferFailed();
    error ZeroAmount();

    IERC20ReserveV2 public immutable reserveAsset;
    bytes32 public immutable issuerId;
    address public immutable administrator;

    uint256 public totalDeposited;
    uint256 public totalPaidOut;
    mapping(bytes32 depositId => bool used) public usedDepositIds;
    mapping(bytes32 redemptionId => bool used) public usedRedemptionIds;

    bool private entered;

    event ReserveDeposited(
        bytes32 indexed issuerId,
        bytes32 indexed depositId,
        address indexed beneficiary,
        address depositor,
        uint256 amount
    );
    event ReservePaidOut(
        bytes32 indexed issuerId,
        bytes32 indexed redemptionId,
        address indexed recipient,
        address operator,
        uint256 amount
    );

    constructor(address reserveAsset_, bytes32 issuerId_, address administrator_) {
        if (reserveAsset_ == address(0) || reserveAsset_.code.length == 0) revert InvalidReserveAsset();
        if (issuerId_ == bytes32(0)) revert InvalidIssuerId();
        if (administrator_ == address(0)) revert InvalidAdministrator();
        reserveAsset = IERC20ReserveV2(reserveAsset_);
        issuerId = issuerId_;
        administrator = administrator_;
    }

    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

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

    /// @notice Pays one Creditcoin redemption request. There is no generic withdrawal path.
    function payout(bytes32 redemptionId, address recipient, uint256 amount) external nonReentrant {
        if (msg.sender != administrator) revert OnlyAdministrator();
        if (redemptionId == bytes32(0)) revert InvalidRedemptionId();
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();
        if (usedRedemptionIds[redemptionId]) revert RedemptionIdAlreadyUsed(redemptionId);

        uint256 available = totalDeposited - totalPaidOut;
        if (amount > available) revert InsufficientRecognizedReserve(available, amount);

        usedRedemptionIds[redemptionId] = true;
        uint256 vaultBefore = reserveAsset.balanceOf(address(this));
        uint256 recipientBefore = reserveAsset.balanceOf(recipient);
        _safeTransfer(address(reserveAsset), recipient, amount);
        uint256 vaultAfter = reserveAsset.balanceOf(address(this));
        uint256 recipientAfter = reserveAsset.balanceOf(recipient);
        uint256 sent = vaultBefore >= vaultAfter ? vaultBefore - vaultAfter : 0;
        uint256 received = recipientAfter >= recipientBefore ? recipientAfter - recipientBefore : 0;
        if (sent != amount || received != amount) revert ReserveAmountMismatch(amount, received);

        totalPaidOut += amount;
        emit ReservePaidOut(issuerId, redemptionId, recipient, msg.sender, amount);
    }

    function recognizedReserve() external view returns (uint256) {
        return totalDeposited - totalPaidOut;
    }

    function reserveBalance() external view returns (uint256) {
        return reserveAsset.balanceOf(address(this));
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool success, bytes memory returnData) = token.call(abi.encodeCall(IERC20ReserveV2.transfer, (to, amount)));
        _requireSuccessfulTransfer(success, returnData);
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool success, bytes memory returnData) =
            token.call(abi.encodeCall(IERC20ReserveV2.transferFrom, (from, to, amount)));
        _requireSuccessfulTransfer(success, returnData);
    }

    function _requireSuccessfulTransfer(bool success, bytes memory returnData) private pure {
        if (!success) revert TransferFailed();
        if (returnData.length == 0) return;
        if (returnData.length != 32 || !abi.decode(returnData, (bool))) revert TransferFailed();
    }
}
