import IO from 'socket.io';
import http, {IncomingMessage, RequestListener, ServerResponse} from "http";
import {
    AppendEntriesRequest,
    AppendEntriesResponse,
    RaftConfig,
    RaftConstant,
    RaftNode,
    RaftRpc,
    RequestVoteRequest,
    RequestVoteResponse
} from "./simple-raft";
import EventEmitter from "events";
import CIO from "socket.io-client";
import assert from "assert";

function clientOption(id: number) {
    return {
        reconnectionDelay: 0,
        forceNew: true,
        extraHeaders: {
            'server-id': id
        }
    }
}

const requestListener: RequestListener = (req: IncomingMessage, res: ServerResponse) => {

};


export default class RaftRpcSocketIo extends EventEmitter implements RaftRpc {

    started: boolean = false;
    private io: IO.Server | null = null;
    private cioMap: Map<number, SocketIOClient.Socket> = new Map();
    private raftNodeMap: Map<number, RaftNode> = new Map();
    private config: RaftConfig | null = null;
    private myId = -1;

    private get me() {
        return `[server:${this.myId}]`;
    }

    end(): void {
        if (!this.started) return;
        this.io?.close(() => console.log(`${this.me}: rpc end ok`));
    }


    start(config: RaftConfig): void {
        if (this.started) return;
        this.config = config;
        this.myId = config.myId;
        const httpServer = http.createServer(requestListener);
        this.io = IO(httpServer, {
            perMessageDeflate: false
        });
        this.io.on('connection', socket => { /* ... */
            let ip = socket.handshake.headers['x-real-ip'] || socket.request.connection.remoteAddress;
            let serverId = socket.handshake.headers['server-id'] || -1;
            console.log(this.me, "connect >> " + serverId + " " + ip + ":" + socket.request.connection.remotePort);
            socket.on('hello', (name) => {
                this.io?.to(socket.id).emit("hello", "hello " + name);
            })
            this.initServerEvent(socket);
        });
        for (const node of config.nodes) {
            if (node.id !== this.myId) {
                let clientSocket = CIO.connect(`${node.address}:${node.port}`, clientOption(this.myId));
                this.initClientEvent(clientSocket);
                this.cioMap.set(node.id, clientSocket);
            }
            this.raftNodeMap.set(node.id, node);
        }
        let myNode = this.raftNodeMap.get(config.myId);
        assert(myNode, `Start fail, ${config.myId} not in ${JSON.stringify(config.nodes)}`);
        this.started = true;
        httpServer.listen(myNode.port, () => console.log(`${this.me}: rpc start ok`));

    }

    private initClientEvent(socket: SocketIOClient.Socket) {
        socket.on(RaftConstant.eventAppendRes, (arg: AppendEntriesResponse) => {
            this.emit(RaftConstant.eventAppendRes, arg);
        });
        socket.on(RaftConstant.eventVoteRes, (arg: RequestVoteResponse) => {
            this.emit(RaftConstant.eventVoteRes, arg);
        });
    }

    private initServerEvent(socket: IO.Socket) {
        socket.on(RaftConstant.eventAppendReq, (arg: AppendEntriesRequest) => {
            this.emit(RaftConstant.eventAppendReq, arg);
        });
        socket.on(RaftConstant.eventVoteReq, (arg: RequestVoteRequest) => {
            this.emit(RaftConstant.eventVoteReq, arg);
        });
    }

    rpcAppendEntries(to: RaftNode, data: AppendEntriesRequest): void {
        let target = this.cioMap.get(to.id);
        assert(target, `rpcAppendEntries fail, ${to.id} not in ${JSON.stringify(this.config?.nodes)}`);
        target.emit(RaftConstant.eventAppendReq, data);
    }

    rpcRequestVote(to: RaftNode, data: RequestVoteRequest): void {
        let target = this.cioMap.get(to.id);
        assert(target, `rpcRequestVote fail, ${to.id} not in ${JSON.stringify(this.config?.nodes)}`);
        target.emit(RaftConstant.eventVoteReq, data);
    }

}
