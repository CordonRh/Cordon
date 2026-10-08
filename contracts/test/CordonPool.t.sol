// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AssetGate} from "../src/AssetGate.sol";
import {CordonPool} from "../src/CordonPool.sol";
import {CordonTest} from "./Base.t.sol";

contract CordonPoolTest is CordonTest {
    address internal bob = makeAddr("bob");

    function _transfer(
        Note memory in0,
        Note memory in1,
        Note memory out0,
        Note memory out1,
        uint256 withdrawRaw,
        address to
    ) internal returns (bytes memory proof, CordonPool.Transfer memory t) {
        bytes32[] memory pub;
        (proof, pub) = _prove("transfer", _transferToml(in0, in1, out0, out1, withdrawRaw, to));
        t = CordonPool.Transfer(
            _u(pub[0]), _u(pub[1]), address(stock), withdrawRaw, to, [_u(pub[5]), _u(pub[6])], [_u(pub[7]), _u(pub[8])]
        );
    }

    function test_poseidonMatchesNoir() public view {
        assertEq(hasher.hash_2(1, 2), 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383);
    }

    function test_depositSplitAndWithdraw() public {
        Note memory a = _depositNote(1000, 11);
        Note memory change = _note(600, 12);
        Note memory dummy = _note(0, 13);

        (bytes memory proof, CordonPool.Transfer memory t) = _transfer(a, dummy, change, _note(0, 14), 400, bob);
        assertEq(t.commits[0], commitOf(change), "circuit commit == solidity commit");
        pool.transact(proof, t);
        _track(t.commits[0]);
        _track(t.commits[1]);
        assertEq(stock.balanceOf(bob), 400);
        assertEq(stock.balanceOf(address(pool)), 600);

        // The same note cannot be spent twice.
        vm.expectRevert(abi.encodeWithSelector(CordonPool.Spent.selector, t.nullifiers[0]));
        pool.transact(proof, t);
    }

    function test_relayerCannotRedirectWithdrawal() public {
        Note memory a = _depositNote(1000, 21);
        (bytes memory proof, CordonPool.Transfer memory t) =
            _transfer(a, _note(0, 22), _note(0, 23), _note(0, 24), 1000, bob);
        t.recipient = makeAddr("relayer");
        vm.expectRevert();
        pool.transact(proof, t);
    }

    function test_withdrawWorksUnderPauseAndRedeemOnly() public {
        Note memory a = _depositNote(1000, 31);
        vm.prank(guardian);
        control.pause(15);
        vm.prank(gov);
        gate.setMode(address(stock), AssetGate.Mode.REDEEM_ONLY);

        (bytes memory proof, CordonPool.Transfer memory t) =
            _transfer(a, _note(0, 32), _note(0, 33), _note(0, 34), 1000, bob);
        pool.transact(proof, t);
        assertEq(stock.balanceOf(bob), 1000);

        vm.expectRevert();
        vm.prank(alice);
        pool.deposit(address(stock), 1, 1);
    }

    function test_cannotWithdrawMoreThanNote() public {
        Note memory a = _depositNote(1000, 41);
        (int256 code,) = _tryProve("transfer", _transferToml(a, _note(0, 42), _note(0, 43), _note(0, 44), 1001, bob));
        assertTrue(code != 0, "unbalanced transfer must not prove");
    }

    function test_unshieldToOriginInStandby() public {
        vm.prank(alice);
        uint256 id = pool.deposit(address(stock), 500, 7);
        uint256 before = stock.balanceOf(alice);
        vm.prank(guardian);
        control.pause(15);
        vm.prank(alice);
        pool.unshieldToOrigin(id);
        assertEq(stock.balanceOf(alice), before + 500);

        vm.expectRevert(abi.encodeWithSelector(CordonPool.DepositSettled.selector, id));
        vm.prank(alice);
        pool.unshieldToOrigin(id);
    }

    function test_flaggedDepositNeverEntersTree() public {
        vm.prank(alice);
        uint256 id = pool.deposit(address(stock), 500, 7);
        vm.prank(keeper);
        screening.flag(id);
        vm.warp(block.timestamp + pool.STANDBY());
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.expectRevert(abi.encodeWithSelector(CordonPool.DepositFlagged.selector, id));
        pool.clear(ids);
        vm.prank(alice);
        pool.unshieldToOrigin(id);
        assertEq(stock.balanceOf(address(pool)), 0);
    }

    function test_clearWaitsForStandby() public {
        vm.prank(alice);
        uint256 id = pool.deposit(address(stock), 500, 7);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.expectRevert(abi.encodeWithSelector(CordonPool.InStandby.selector, id));
        pool.clear(ids);
    }

    /// Only the depositor can take a pending deposit back, so nobody can keep other
    /// people's deposits out of the tree.
    function test_onlyOriginUnshields() public {
        vm.prank(alice);
        uint256 id = pool.deposit(address(stock), 500, 7);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CordonPool.NotOrigin.selector, id));
        pool.unshieldToOrigin(id);
    }

    function test_clearSkipsSettledIds() public {
        vm.startPrank(alice);
        uint256 a = pool.deposit(address(stock), 500, 7);
        uint256 b = pool.deposit(address(stock), 600, 8);
        pool.unshieldToOrigin(a);
        vm.stopPrank();
        vm.warp(block.timestamp + pool.STANDBY());
        uint256[] memory ids = new uint256[](2);
        (ids[0], ids[1]) = (a, b);
        pool.clear(ids);
        assertEq(pool.nextLeaf(), 1, "only the live deposit entered");
    }

    /// The root history counts calls, not leaves: one big clear() keeps older roots known.
    function test_rootHistorySpansCalls() public {
        _depositNote(1000, 51);
        uint256 old = pool.currentRoot();
        uint256 n = pool.ROOT_HISTORY() + 20;
        uint256[] memory ids = new uint256[](n);
        vm.startPrank(alice);
        stock.approve(address(pool), type(uint256).max);
        for (uint256 i; i < n; ++i) {
            ids[i] = pool.deposit(address(stock), 1, 100 + i);
        }
        vm.stopPrank();
        vm.warp(block.timestamp + pool.STANDBY());
        pool.clear(ids);
        assertTrue(pool.isKnownRoot(old), "a pending proof's root survives one large call");
    }

    /// A full withdrawal has two empty outputs: no leaf, and nothing a decoy could lock.
    function test_fullWithdrawalTakesNoLeaf() public {
        Note memory a = _depositNote(1000, 61);
        uint256 before = pool.nextLeaf();
        (bytes memory proof, CordonPool.Transfer memory t) =
            _transfer(a, _note(0, 62), _note(0, 63), _note(0, 64), 1000, bob);
        assertEq(t.commits[0], 0);
        assertEq(t.commits[1], 0);
        pool.transact(proof, t);
        assertEq(pool.nextLeaf(), before);
        assertEq(stock.balanceOf(bob), 1000);
    }

    function test_onlyEnginesApplyOps() public {
        uint256 root = pool.currentRoot();
        vm.expectRevert(CordonPool.NotEngine.selector);
        pool.applyOp(root, new uint256[](0), new uint256[](0));
    }

    /// Immutability (spec §6): the pool's whole external surface, with nothing that
    /// could pause exits, move funds on an owner's say, or upgrade it.
    function test_poolHasNoAdminSelectors() public view {
        string memory json = vm.readFile("out/CordonPool.sol/CordonPool.json");
        string[] memory sigs = vm.parseJsonKeys(json, ".methodIdentifiers");
        string[21] memory allowed = [
            "DEPTH()",
            "MAX_PROOF_AGE()",
            "ROOT_HISTORY()",
            "STANDBY()",
            "applyOp(uint256,uint256[],uint256[])",
            "assetGate()",
            "clear(uint256[])",
            "collectFees(address)",
            "control()",
            "creditFee(address,uint256)",
            "currentRoot()",
            "deposit(address,uint256,uint256)",
            "depositCount()",
            "deposits(uint256)",
            "fees(address)",
            "hasher()",
            "isKnownRoot(uint256)",
            "nextLeaf()",
            "nullified(uint256)",
            "owed(address)",
            "roots(uint256)"
        ];
        string[5] memory allowed2 = [
            "rootIndex()",
            "screening()",
            "transact(bytes,(uint256,uint256,address,uint256,address,uint256[2],uint256[2]))",
            "transferVerifier()",
            "unshieldToOrigin(uint256)"
        ];
        assertEq(sigs.length, allowed.length + allowed2.length, "unexpected pool function");
        for (uint256 i; i < sigs.length; ++i) {
            bool ok;
            for (uint256 j; j < allowed.length; ++j) {
                ok = ok || keccak256(bytes(sigs[i])) == keccak256(bytes(allowed[j]));
            }
            for (uint256 j; j < allowed2.length; ++j) {
                ok = ok || keccak256(bytes(sigs[i])) == keccak256(bytes(allowed2[j]));
            }
            assertTrue(ok, sigs[i]);
        }
    }
}
