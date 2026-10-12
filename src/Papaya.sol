// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "./interfaces/IPapaya.sol";
import "./library/UserLib.sol";

// Arc adaptation of Papaya. Default fees are stored in defaultFeeSettings[projectId].
contract Papaya is IPapaya, Ownable, ReentrancyGuard, Multicall {
    using SafeERC20 for IERC20;
    using UserLib for UserLib.User;
    using EnumerableMap for EnumerableMap.AddressToUintMap;

    uint256 public constant FLOOR = 10000;
    uint256 public constant MAX_PROTOCOL_FEE = FLOOR * 20 / 100;

    uint256 public constant APPROX_LIQUIDATE_GAS = 160000;
    uint256 public constant APPROX_SUBSCRIPTION_GAS = 10000;
    uint8 public constant SUBSCRIPTION_THRESHOLD = 100;

    uint32 public constant REFILL_DAYS = 30 days;
    uint32 public constant REFILL_GAS_COST = 120000;

    // Arc native USDC (18 decimals) and this ERC-20 interface (6 decimals) share one balance.
    address public constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    IERC20 public immutable TOKEN;
    uint256 public immutable DECIMALS_SCALE;

    uint256 public totalSupply;
    address[] public projectOwners;
    mapping(address account => UserLib.User) public users;
    mapping(address account => EnumerableMap.AddressToUintMap) private _subscriptions;

    mapping(uint256 projectId => uint16 projectFee) public defaultFeeSettings;
    mapping(uint256 projectId => mapping(address account => uint16 projectFee)) public userFeeSettings;

    modifier onlyValidProjectId(uint256 projectId) {
        if (projectId >= projectOwners.length) revert InvalidProjectId(projectId);
        _;
    }

    modifier onlyProjectAdmin(uint256 projectId) {
        if (projectId >= projectOwners.length) revert InvalidProjectId(projectId);
        if (projectOwners[projectId] != _msgSender()) revert AccessDenied(projectId);
        _;
    }

    modifier onlyValidSettings(uint16 projectFee) {
        if (projectFee > MAX_PROTOCOL_FEE) revert WrongPercent();
        _;
    }

    modifier onlyNotSender(address account) {
        if (_msgSender() == account) revert NotLegal();
        _;
    }

    constructor(address owner_) Ownable(owner_) {
        TOKEN = IERC20(ARC_USDC);
        require(IERC20Metadata(ARC_USDC).decimals() == 6, "Arc USDC must have 6 decimals");
        DECIMALS_SCALE = 1e12;
    }

    function name() external view returns (string memory) {
        return string.concat("Streaming ", IERC20Metadata(address(TOKEN)).name());
    }

    function symbol() external view returns (string memory) {
        return string.concat("pp", IERC20Metadata(address(TOKEN)).symbol());
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function rescueFunds(IERC20 token, uint256 amount) external onlyOwner nonReentrant {
        // Arc USDC rescue is intentionally disabled in this demo, through both interfaces.
        // A future production policy must account for positive user claims / solvency,
        // rather than treating net signed totalSupply as the amount of protected funds.
        if (address(token) == address(0) || token == TOKEN) revert WrongToken();
        token.safeTransfer(owner(), amount);
    }

    function claimProjectId(address projectOwner) external onlyOwner {
        if (projectOwner == address(0)) revert NotLegal();
        require(projectOwners.length <= type(uint64).max, "Project ID overflow");
        emit ProjectIdClaimed(projectOwners.length, projectOwner);

        projectOwners.push(projectOwner);
    }

    function setDefaultFee(uint16 projectFee, uint256 projectId)
        external
        onlyProjectAdmin(projectId)
        onlyValidSettings(projectFee)
    {
        defaultFeeSettings[projectId] = projectFee;

        emit SetDefaultFee(projectId, projectFee);
    }

    function setFeeForUser(address user, uint16 projectFee, uint256 projectId)
        external
        onlyProjectAdmin(projectId)
        onlyValidSettings(projectFee)
    {
        userFeeSettings[projectId][user] = projectFee;
        emit SetFeeForUser(projectId, user, projectFee);
    }

    function balanceOf(address account) external view returns (uint256) {
        return uint256(SignedMath.max(users[account].balanceOf(), int256(0)));
    }

    function allProjectOwners() external view returns (address[] memory) {
        return projectOwners;
    }

    function subscriptions(address from, address to) external view returns (bool, uint256 encodedRates) {
        return _subscriptions[from].tryGet(to);
    }

    function allSubscriptions(address from) external view returns (address[] memory to, uint256[] memory encodedRates) {
        EnumerableMap.AddressToUintMap storage user_subscriptions = _subscriptions[from];
        to = user_subscriptions.keys();
        encodedRates = new uint256[](to.length);

        for (uint256 i; i < to.length; i++) {
            encodedRates[i] = user_subscriptions.get(to[i]);
        }
    }

    function deposit(uint256 amount, bool isPermit2) external nonReentrant {
        _deposit(TOKEN, _msgSender(), _msgSender(), amount, isPermit2);
    }

    function depositFor(uint256 amount, address to, bool isPermit2) external nonReentrant {
        _deposit(TOKEN, _msgSender(), to, amount, isPermit2);
    }

    function _deposit(IERC20 token, address from, address to, uint256 amount, bool usePermit2) internal virtual {
        if (to == address(0) || usePermit2) revert NotLegal();
        _update(address(0), to, amount * DECIMALS_SCALE);

        token.safeTransferFrom(from, address(this), amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        _withdraw(TOKEN, _msgSender(), _msgSender(), amount);
    }

    function withdrawTo(address to, uint256 amount) external nonReentrant {
        if (to == address(0)) revert NotLegal();
        _withdraw(TOKEN, _msgSender(), to, amount);
    }

    function _withdraw(IERC20 token, address from, address to, uint256 amount) internal {
        //Erasing non significant decimals
        _update(from, address(0), amount / DECIMALS_SCALE * DECIMALS_SCALE);
        token.safeTransfer(to, amount / DECIMALS_SCALE);
    }

    function pay(address receiver, uint256 amount) external {
        _update(_msgSender(), receiver, amount);
    }

    function subscribe(address author, uint96 subscriptionRate, uint256 projectId)
        external
        onlyValidProjectId(projectId)
        onlyNotSender(author)
    {
        if (author == address(0) || subscriptionRate == 0) revert NotLegal();
        (bool success, uint256 encodedRates) = _subscriptions[_msgSender()].tryGet(author);
        if (success) {
            // If already subscribed, unsubscribe to be able to subscribe again
            _unsubscribeEffects(_msgSender(), author, encodedRates);
        }

        if (_subscriptions[_msgSender()].length() == SUBSCRIPTION_THRESHOLD) revert ExcessOfSubscriptions();

        uint16 fee = userFeeSettings[projectId][author];
        if (fee == 0) {
            fee = defaultFeeSettings[projectId];
        }

        uint96 incomeRate = uint96(uint256(subscriptionRate) * (FLOOR - fee) / FLOOR);
        _subscribeEffects(_msgSender(), author, incomeRate, subscriptionRate, projectId);
    }

    function unsubscribe(address author) external {
        (bool success, uint256 encodedRates) = _subscriptions[_msgSender()].tryGet(author);
        if (!success) revert NotSubscribed();

        _unsubscribeEffects(_msgSender(), author, encodedRates);
    }

    /// @notice Internal 18-decimal USDC cost, with no exchange-rate oracle.
    function executionPrice(address account) external view returns (uint256) {
        return uint256(_executionPriceInToken(account));
    }

    /// @notice Whole micro-USDC pulled for one 30-day NET-outflow refill, rounded up.
    function refillQuote(address account) public view returns (uint256) {
        int256 net = users[account].diffIncomeOutgoing();
        if (net >= 0) return 0;
        return (uint256(-net) * REFILL_DAYS + DECIMALS_SCALE - 1) / DECIMALS_SCALE;
    }

    function liquidate(address account) external onlyNotSender(account) nonReentrant {
        UserLib.User storage user = users[account];
        if (!user.isLiquidatable(_executionPriceInToken(account))) revert NotLiquidatable();
        uint256 tokenAmount = refillQuote(account);
        uint256 refillAmount = tokenAmount * DECIMALS_SCALE;
        uint256 reward = uint256(_executionPriceInToken(address(0)));
        // A tiny net outflow must not permit repeated refills which only pay rewards.
        bool useful = refillAmount > reward
            && user.balanceOf() + int256(refillAmount - reward)
                >= _executionPriceInToken(account) + user.outgoingRate * int256(1 days);
        if (useful && _trySafeTransferFrom(account, tokenAmount)) {
            totalSupply += refillAmount;
            users[_msgSender()].increaseBalance(reward);
            user.increaseBalance(refillAmount - reward);
            emit Transfer(address(0), _msgSender(), reward);
            emit Transfer(address(0), account, refillAmount - reward);
            emit Refill(account, refillAmount);
        } else {
            EnumerableMap.AddressToUintMap storage subs = _subscriptions[account];
            for (uint256 i = subs.length(); i > 0; i--) {
                (address author, uint256 encodedRates) = subs.at(i - 1);
                _unsubscribeEffects(account, author, encodedRates);
            }
            // Keep the original signed-debt model, but never silently put an unfunded
            // liquidator into debt. Late liquidation requires a sufficient internal deposit.
            int256 debt = user.balanceOf();
            if (debt < 0 && users[_msgSender()].balanceOf() < -debt) revert UserLib.TopUpBalance();
            int256 balance = user.drainBalance(users[_msgSender()]);
            emit Transfer(account, _msgSender(), uint256(SignedMath.max(int256(0), balance)));
            emit Liquidated(account, _msgSender());
        }
    }

    function _executionPriceInToken(address account) internal view returns (int256) {
        // gas * native-USDC-wei/gas = internal-USDC-wei. Conversion ratio = 1.
        uint256 gasUnits = account == address(0)
            ? REFILL_GAS_COST
            : APPROX_LIQUIDATE_GAS + APPROX_SUBSCRIPTION_GAS * _subscriptions[account].length();
        return int256(_gasPrice() * gasUnits);
    }

    function _subscribeEffects(address user, address author, uint96 incomeRate, uint96 outgoingRate, uint256 projectId)
        internal
    {
        uint256 encodedRates = _encodeRates(incomeRate, outgoingRate, projectId);
        _subscriptions[user].set(author, encodedRates);
        users[user].increaseOutgoingRate(outgoingRate, _executionPriceInToken(user));
        users[author].increaseIncomeRate(incomeRate);
        users[projectOwners[projectId]].increaseIncomeRate(outgoingRate - incomeRate);

        emit StreamCreated(user, author, encodedRates);
    }

    function _unsubscribeEffects(address user, address author, uint256 encodedRates) internal {
        (uint96 incomeRate, uint96 outgoingRate, uint256 projectId) = _decodeRates(encodedRates);
        address admin = projectOwners[projectId];
        users[user].decreaseOutgoingRate(outgoingRate);
        users[author].decreaseIncomeRate(incomeRate, _executionPriceInToken(author));
        users[admin].decreaseIncomeRate(outgoingRate - incomeRate, _executionPriceInToken(admin));
        _subscriptions[user].remove(author);

        emit StreamRevoked(user, author, encodedRates);
    }

    function _update(address from, address to, uint256 amount) private {
        if (from == to || amount == 0) return;

        if (from == address(0)) {
            totalSupply += amount;
        } else {
            users[from].decreaseBalance(amount, _executionPriceInToken(from));
        }

        if (to == address(0)) {
            totalSupply -= amount;
        } else {
            users[to].increaseBalance(amount);
        }

        emit Transfer(from, to, amount);
    }

    function _encodeRates(uint96 incomeRate, uint96 outgoingRate, uint256 projectId)
        internal
        pure
        returns (uint256 encodedRates)
    {
        return uint256(incomeRate) | (uint256(outgoingRate) << 96) | (uint256(projectId) << 192);
    }

    function _decodeRates(uint256 encodedRates)
        internal
        pure
        returns (uint96 incomeRate, uint96 outgoingRate, uint256 projectId)
    {
        incomeRate = uint96(encodedRates);
        outgoingRate = uint96(encodedRates >> 96);
        projectId = encodedRates >> 192;
    }

    function _trySafeTransferFrom(address account, uint256 amount) internal returns (bool success) {
        address tokenAddr = address(TOKEN);
        bytes4 selector = IERC20.transferFrom.selector;

        //error catch of ERC20 transferFrom
        assembly ("memory-safe") {
            // solhint-disable-line no-inline-assembly
            let data := mload(0x40)

            mstore(data, selector)
            mstore(add(data, 0x04), account)
            mstore(add(data, 0x24), address())
            mstore(add(data, 0x44), amount)
            success := call(gas(), tokenAddr, 0, data, 100, 0x0, 0x20)

            if success {
                switch returndatasize()
                case 0 {
                    success := gt(extcodesize(tokenAddr), 0)
                }
                default {
                    success := and(gt(returndatasize(), 31), eq(mload(0), 1))
                }
            }
        }
    }

    function _gasPrice() internal view virtual returns (uint256) {
        return block.basefee;
    }
}
