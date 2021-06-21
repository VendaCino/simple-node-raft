import {suite, test, timeout} from '@testdeck/mocha';
import {
    makeDefaultRaftTimerConfig,
    RaftConfig,
    RaftNode,
    RaftRole,
    RaftServer
} from "../src/simple-raft";
import RaftRpcSocketIo from "../src/raft-socket-io-rpc";
import {assert} from 'chai';
import {sleep} from "../src/async_utils";

let stopTimer = false;

class TestRaftServer extends RaftServer {
    _origin: number = Date.now();
    _lastValue = Date.now();

    now(): number {
        if (!this._origin) this._origin = Date.now();
        if (stopTimer) return this._lastValue;
        this._lastValue = (Date.now() - this._origin) / 2 + this._origin
        return this._lastValue;
    }
}

function makeNode(id: number): RaftNode {
    return {
        address: "http://localhost", id: id, port: 10000 + id
    }
}

const nodes: Array<RaftNode> = [makeNode(1), makeNode(2), makeNode(3),
    makeNode(4), makeNode(5)
];
const timerConfig = makeDefaultRaftTimerConfig(5);

function makeConfig(id: number): RaftConfig {
    return {
        myId: id, nodes: nodes, timerConfig: timerConfig
    }
}

const ss: Array<RaftServer> = [];
nodes.forEach(e => ss.push(new TestRaftServer(new RaftRpcSocketIo(makeConfig(e.id)), makeConfig(e.id))));

@timeout(5000)
@suite()
class SimpleRaftTest {

    static before(done) {
        stopTimer = false;
        console.log("before")
        ss.forEach(s => s.start());
        setTimeout(() => done(), 500);
    }

    static after(done) {
        console.log("after")
        ss.forEach(s => s.end());
        setTimeout(() => done(), 1000);
    }

    @test
    async 'Server Has One Leader'() {
        await sleep(1000);
        assert.equal(ss.filter(e => e.role === RaftRole.Leader).length, 1)
    }

    @test
    async 'Server Has One Leader 2'() {
        await sleep(500);
        assert.equal(ss.filter(e => e.role === RaftRole.Leader).length, 1)
    }

    @test
    async 'Server Has One Leader 3'() {
        let lastLeader = ss.filter(e => e.role === RaftRole.Leader)[0];
        lastLeader.end();
        await sleep(1000);
        assert.equal(ss.filter(e => e.role === RaftRole.Leader).length, 2)
        lastLeader.start();
        await sleep(200);
    }

    @test
    async 'Client Add Log'() {
        await sleep(500);
        let leader = ss.filter(e => e.role === RaftRole.Leader)[0];
        let result = await leader.submitLog("key", {});
        let leaderLog = leader.lastLog;
        console.log(leaderLog);
        assert.isTrue(result);
        ss.forEach(e => e.logMe(JSON.stringify(e.lastLog)));
        let sameLogLength = ss.filter(e => JSON.stringify(e.lastLog) === JSON.stringify(leaderLog)).length;
        assert.isTrue(sameLogLength > nodes.length / 2);
    }

    @test
    async 'Client Add Log 2'() {
        await sleep(500);
        let leader = ss.filter(e => e.role === RaftRole.Leader)[0];
        let result2 = leader.submitLog("key2", {});
        let result3 = leader.submitLog("key3", {});
        let result4 = leader.submitLog("key4", {});
        assert.isTrue(await result2);
        assert.isTrue(await result3);
        let leaderLog = leader.lastLog;
        console.log(leaderLog);
        ss.forEach(e => e.logMe(JSON.stringify(e.lastLog)));
        let sameLogLength = ss.filter(e => JSON.stringify(e.lastLog) === JSON.stringify(leaderLog)).length;
        assert.isTrue(sameLogLength > nodes.length / 2);
    }

    @timeout(5000)
    @test
    async 'Client Add Log 3'() {
        await sleep(500);
        let leader = ss.filter(e => e.role === RaftRole.Leader)[0];
        let result2 = leader.submitLog("key2", {});
        await sleep(500);
        let result3 = leader.submitLog("key3", {});
        leader.end();
        await sleep(500);
        let leader2 = ss.filter(e => e.role === RaftRole.Leader && e !== leader)[0];
        let result4 = leader2.submitLog("key4", {});
        assert.isTrue(await result2);
        assert.isFalse(await result3);
        assert.isTrue(await result4);
        let leaderLog = leader2.lastLog;
        console.log(leaderLog);
        ss.forEach(e => e.logMe(JSON.stringify(e.lastLog)));
        let sameLogLength = ss.filter(e => JSON.stringify(e.lastLog) === JSON.stringify(leaderLog)).length;
        assert.isTrue(sameLogLength > nodes.length / 2);
    }

    @timeout(5000)
    @test
    async 'Client Add Log 4'() {
        await sleep(500);
        let leader = ss.filter(e => e.role === RaftRole.Leader)[0];
        let result2 = leader.submitLog("key2", {});
        await sleep(500);
        let result3 = leader.submitLog("key3", {});
        leader.end();
        await sleep(500);
        let leader2 = ss.filter(e => e.role === RaftRole.Leader && e !== leader)[0];
        let result4 = leader2.submitLog("key4", {});
        leader.start();
        let result5 = leader.submitLog("key4", {});
        assert.isTrue(await result2);
        assert.isFalse(await result3);
        assert.isTrue(await result4);
        assert.isFalse(await result5);
        let leaderLog = leader2.lastLog;
        console.log(leaderLog);
        ss.forEach(e => e.logMe(JSON.stringify(e.lastLog)));
        let sameLogLength = ss.filter(e => JSON.stringify(e.lastLog) === JSON.stringify(leaderLog)).length;
        assert.isTrue(sameLogLength > nodes.length / 2);
    }

}
