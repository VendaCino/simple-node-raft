import {makeDefaultRaftTimerConfig, RaftConfig, RaftNode, RaftServer} from "./simple-raft";
import RaftRpcSocketIo from "./raft-socket-io-rpc";


class SlowRaftServer extends RaftServer {
    _origin: number = Date.now();

    now(): number {
        if (!this._origin) this._origin = Date.now();
        return (Date.now() - this._origin) / 40 + this._origin;
    }
}

function makeNode(id: number): RaftNode {
    return {
        address: "http://localhost", id: id, port: 10000 + id
    }
}

const nodes: Array<RaftNode> = [makeNode(1), makeNode(2), makeNode(3), makeNode(4), makeNode(5)];

function makeConfig(id: number): RaftConfig {
    return {
        myId: id, nodes: nodes, timerConfig: makeDefaultRaftTimerConfig(10)
    }
}

const ss: Array<RaftServer> = [new SlowRaftServer(new RaftRpcSocketIo(makeConfig(1)), makeConfig(1)),
    new SlowRaftServer(new RaftRpcSocketIo(makeConfig(2)), makeConfig(2)),
    new SlowRaftServer(new RaftRpcSocketIo(makeConfig(3)), makeConfig(3)),
    // new SlowRaftServer(new RaftRpcSocketIo(makeConfig(4)), makeConfig(4)),
    // new SlowRaftServer(new RaftRpcSocketIo(makeConfig(5)), makeConfig(5)),
]

ss.forEach(s => s.start());
console.log("Server Start")

process.on('SIGINT', function () {
    console.log("Caught interrupt signal");
    ss.forEach(s => s.end());
    setTimeout(() => process.exit(), 2000);
});

