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

const ss: Array<RaftServer> = [new TestRaftServer(new RaftRpcSocketIo(makeConfig(1)), makeConfig(1)),
    new TestRaftServer(new RaftRpcSocketIo(makeConfig(2)), makeConfig(2)),
    new TestRaftServer(new RaftRpcSocketIo(makeConfig(3)), makeConfig(3)),
    // new SlowRaftServer(new RaftRpcSocketIo(makeConfig(4)), makeConfig(4)),
    // new SlowRaftServer(new RaftRpcSocketIo(makeConfig(5)), makeConfig(5)),
]

@suite
class SimpleRaftTest {

    static before(done) {
        stopTimer = true;
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
        assert.equal(ss.filter(e => e.role === RaftRole.Leader).length, 0)
        stopTimer = false;
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
    }

}
