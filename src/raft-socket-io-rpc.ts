import IO from 'socket.io';
import http, {IncomingMessage, RequestListener, Server, ServerResponse} from "http";
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
    private config: RaftConfig;
    private myId = -1;
    private httpServer: Server | undefined;


    constructor(config: RaftConfig) {
        super();
        this.config = config;
    }

    private get me() {
        return `[server:${this.myId}]`;
    }

    end(): void {
        if (!this.started) return;
        this.io?.close(() => console.log(`${this.me}: rpc end ok`));
        this.httpServer?.close(() => console.log(`${this.me}: rpc server end ok`))
        for (let socket of this.cioMap.values()) {
            socket.close();
        }
        this.started = false;
    }


    start(): void {
        const config: RaftConfig = this.config;
        if (this.started) return;
        this.config = config;
        this.myId = config.myId;
        const httpServer = http.createServer(requestListener);
        this.httpServer = httpServer;
        this.io = IO(httpServer, {
            perMessageDeflate: false
        });
        for (const node of config.nodes) {
            this.raftNodeMap.set(node.id, node);
        }
        this.io.on('connection', socket => { /* ... */
            let ip = socket.handshake.headers['x-real-ip'] || socket.request.connection.remoteAddress;
            let serverId = parseInt(socket.handshake.headers['server-id'] || "-1");
            console.log(this.me, "connect >> " + serverId + " " + ip + ":" + socket.request.connection.remotePort);
            socket.on('hello', (name) => {
                this.io?.to(socket.id).emit("hello", "hello " + name);
            })
            let node = this.raftNodeMap.get(serverId)!;
            this.initServerEvent(socket, node);
        });
        for (const node of config.nodes) {
            if (node.id !== this.myId) {
                let clientSocket = CIO.connect(`${node.address}:${node.port}`, clientOption(this.myId));
                this.initClientEvent(clientSocket, node);
                this.cioMap.set(node.id, clientSocket);
            }
        }
        let myNode = this.raftNodeMap.get(config.myId);
        assert(myNode, `Start fail, ${config.myId} not in ${JSON.stringify(config.nodes)}`);
        this.started = true;
        httpServer.listen(myNode.port, () => console.log(`${this.me}: rpc start ok`));

    }

    private initClientEvent(socket: SocketIOClient.Socket, node: RaftNode) {

    }

    private initServerEvent(socket: IO.Socket, node: RaftNode) {
        socket.on(RaftConstant.eventAppendReq, (arg: AppendEntriesRequest) => {
            this.emit(RaftConstant.eventAppendReq, arg, node);
        });
        socket.on(RaftConstant.eventVoteReq, (arg: RequestVoteRequest) => {
            this.emit(RaftConstant.eventVoteReq, arg, node);
        });
        socket.on(RaftConstant.eventAppendRes, (arg: AppendEntriesResponse) => {
            this.emit(RaftConstant.eventAppendRes, arg, node);
        });
        socket.on(RaftConstant.eventVoteRes, (arg: RequestVoteResponse) => {
            this.emit(RaftConstant.eventVoteRes, arg, node);
        });
    }

    rpcAppendEntries(to: RaftNode, data?: AppendEntriesRequest): void {
        let target = this.cioMap.get(to.id);
        assert(target, `rpcAppendEntries fail, ${to.id} not in ${JSON.stringify(this.config.nodes)}`);
        target.emit(RaftConstant.eventAppendReq, data);
    }

    rpcRequestVote(to: RaftNode, data: RequestVoteRequest): void {
        let target = this.cioMap.get(to.id);
        assert(target, `rpcRequestVote fail, ${to.id} not in ${JSON.stringify(this.config.nodes)}`);
        target.emit(RaftConstant.eventVoteReq, data);
    }

    rpcRtnRequestVote(to: RaftNode, data: RequestVoteResponse): void {
        let target = this.cioMap.get(to.id);
        assert(target, `rpcRtnRequestVote fail, ${to.id} not in ${JSON.stringify(this.config.nodes)}`);
        target.emit(RaftConstant.eventVoteRes, data);
    }

    rpcRtnAppendEntries(to: RaftNode, data: AppendEntriesResponse): void {
        let target = this.cioMap.get(to.id);
        assert(target, `rpcRtnAppendEntries fail, ${to.id} not in ${JSON.stringify(this.config.nodes)}`);
        target.emit(RaftConstant.eventAppendRes, data);
    }

}
