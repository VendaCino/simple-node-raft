import {
    AppendEntriesRequest,
    AppendEntriesResponse,
    RaftConfig,
    RaftNode,
    RaftRole,
    RaftServer,
    RaftTimerConfig,
    RequestVoteRequest,
    RequestVoteResponse
} from "../src/simple-raft";
import RaftRpcSocketIo from "../src/raft-socket-io-rpc";
import http, {IncomingMessage, ServerResponse} from "http";
import IO from "socket.io";
import * as fs from "fs";
import {sleep} from "../src/async_utils";

const httpServer = http.createServer(handleRequest);
const io = IO(httpServer, {
    perMessageDeflate: false
});

function randOf(max: number) {
    return Math.random() * max;
}

let sendDelay = 10;
let sendDelayRand = 10;
let slowScale = 20;

function sendDelayTime() {
    return (sendDelay + randOf(sendDelayRand)) * slowScale;
}

class SlowRaftRpcSocketIo extends RaftRpcSocketIo {

    rpcAppendEntries(to: RaftNode, data?: AppendEntriesRequest) {
        setTimeout(() => super.rpcAppendEntries(to, data), sendDelayTime());
    }

    rpcRequestVote(to: RaftNode, data: RequestVoteRequest) {
        setTimeout(() => super.rpcRequestVote(to, data), sendDelayTime());
    }

    rpcRtnRequestVote(to: RaftNode, data: RequestVoteResponse) {
        setTimeout(() => super.rpcRtnRequestVote(to, data), sendDelayTime());
    }

    rpcRtnAppendEntries(to: RaftNode, data: AppendEntriesResponse) {
        setTimeout(() => super.rpcRtnAppendEntries(to, data), sendDelayTime());
    }

    rpcSendHeartToAll(data: AppendEntriesRequest) {
        setTimeout(() => super.rpcSendHeartToAll(data), sendDelayTime());
    }
}

class SlowRaftServer extends RaftServer {

    _origin: number = Date.now();

    now(): number {
        if (!this._origin) this._origin = Date.now();
        return (Date.now() - this._origin) / slowScale + this._origin;
    }

    logMe(msg: string) {
        super.logMe(msg);
        io.emit("debugLog", {
            id: this.myId,
            msg: msg
        });
    }

    becomeCandidate() {
        super.becomeCandidate();
        io.emit("updateAllStatus", getAllStatus());
    }

    becomeLeader() {
        super.becomeLeader();
        io.emit("updateAllStatus", getAllStatus());
    }

    becomeFollower() {
        super.becomeFollower();
        io.emit("updateAllStatus", getAllStatus());
    }

    async submitLog(key: string, data: Object): Promise<Boolean> {
        let r = super.submitLog(key, data);
        io.emit("updateAllStatus", getAllStatus());
        return r;
    }

    protected onRpcAppendEntriesRequest(req: AppendEntriesRequest, from: RaftNode) {
        super.onRpcAppendEntriesRequest(req, from);
        if (req.entries.length > 0) {
            io.emit("updateAllStatus", getAllStatus());
            sleep(300).then(() => io.emit("updateAllStatus", getAllStatus()));
        }
    }

    protected onRpcAppendEntriesResponse(res: AppendEntriesResponse, from: RaftNode) {
        super.onRpcAppendEntriesResponse(res, from);
    }

    async commit(index: number): Promise<void> {
        sleep(100).then(() => io.emit("updateAllStatus", getAllStatus()));
        return super.commit(index);
    }

}

function makeNode(id: number): RaftNode {
    return {
        address: "http://localhost", id: id, port: 10000 + id
    }
}

const nodes: Array<RaftNode> = [makeNode(1), makeNode(2), makeNode(3)
    , makeNode(4), makeNode(5)
];

function makeTestRaftTimerConfig(rtt: number): RaftTimerConfig {
    return {
        coldTimeOfLeaderHeart: 1.2 * rtt,
        timeoutOfNoLeaderHeart: 2 * rtt,
        timeoutOfNoLeaderElected: 3 * rtt,
        coldTimeOfLeaderUpdateLog: 5 * rtt
    }
}

function makeConfig(id: number): RaftConfig {
    return {
        myId: id, nodes: nodes, timerConfig: makeTestRaftTimerConfig(sendDelay + sendDelayRand)
    }
}

const ss: Array<RaftServer> = [];
nodes.forEach(e => ss.push(new SlowRaftServer(new SlowRaftRpcSocketIo(makeConfig(e.id)), makeConfig(e.id))));

ss.forEach(s => s.start());
console.log("Server Start")

process.on('SIGINT', function () {
    console.log("Caught interrupt signal");
    ss.forEach(s => s.end());
    setTimeout(() => process.exit(), 2000);
});


function handleRequest(req: IncomingMessage, res: ServerResponse) {
    try {
        if (req.url === "/") {
            res.setHeader('Content-type', 'text/html;charset=utf-8');
            fs.createReadStream(`${__dirname}/simple_raft_test.html`).pipe(res)
        }
    } catch (err) {
        console.log(err)
    }
}

function getAllStatus() {
    return ss.map(e => {
        return {
            id: e.myId,
            role: e.role,
            term: e.currentTerm,
            log: e.persis.log,
            end: e._end,
            commit: e.commitIndex
        }
    });
}

io.on('connection', socket => { /* ... */
    let ip = socket.handshake.headers['x-real-ip'] || socket.request.connection.remoteAddress;
    console.log("TestServer connect >> " + ip + ":" + socket.request.connection.remotePort);
    socket.on('hello', (name) => {
        console.log(name);
        io?.to(socket.id).emit("hello", "hello " + name);
    })
    socket.on("reset", () => {
        console.log("RESET!!!!")
        ss.forEach(s => s.end());
        while (ss.length > 0) ss.pop();
        nodes.forEach(e => ss.push(new SlowRaftServer(new SlowRaftRpcSocketIo(makeConfig(e.id)), makeConfig(e.id))));
        ss.forEach(s => s.start());
    })
    socket.on("updateAllStatus", () => {
        io.emit("updateAllStatus", getAllStatus());
    })
    socket.on("stop", id => {
        ss.filter(e => e.myId === id).forEach(e => e.end());
        sleep(300).then(() => io.emit("updateAllStatus", getAllStatus()));
    })
    socket.on("start", id => {
        ss.filter(e => e.myId === id).forEach(e => e.start());
        sleep(300).then(() => io.emit("updateAllStatus", getAllStatus()));
    })
    socket.on("submitLog", (key) => {
        ss.filter(e => !e._end && e.role === RaftRole.Leader).forEach(e => e.submitLog(key, {}));
    })
    socket.on("setSlowScale", (scale) => {
        slowScale = Math.max(1, scale);
    })
});
httpServer.listen(10086);
