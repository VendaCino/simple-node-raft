import {suite, test} from '@testdeck/mocha';
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
    // makeNode(4), makeNode(5)
];
const timerConfig = makeDefaultRaftTimerConfig(5);

function makeConfig(id: number): RaftConfig {
    return {
        myId: id, nodes: nodes, timerConfig: timerConfig
    }
}

const ss: Array<RaftServer> = [];
nodes.forEach(e => ss.push(new TestRaftServer(new RaftRpcSocketIo(makeConfig(e.id)), makeConfig(e.id))));

@suite
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
        let leader = ss.filter(e => e.role === RaftRole.Leader)[0];
        let result = await leader.submitLog("key", {});
        let leaderLog = leader.lastLog;
        assert.isTrue(result);
        ss.forEach(e => assert.deepEqual(e.lastLog, leaderLog));
    }

}
