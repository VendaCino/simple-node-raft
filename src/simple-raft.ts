export enum RaftState {
    Follower, Candidate, Leader
}

export class RaftConstant {
    static eventVoteReq = 'onRpcRequestVoteRequest';
    static eventVoteRes = 'onRpcRequestVoteResponse';
    static eventAppendReq = 'onRpcAppendEntriesRequest';
    static eventAppendRes = 'onRpcAppendEntriesResponse';
}

export interface RaftConfig {
    myId: number;
    nodes: Array<RaftNode>;
}

export interface RaftLog {

}

export interface RequestVoteResponse {
    term: number;
    success: boolean;
}

export interface AppendEntriesResponse {
    term: number;
    voteGranted: boolean;
}

export interface RequestVoteRequest {
    term: number;
    candidateId: number;
    lastLogIndex: number;
    lastLogTerm: number;
}

export interface AppendEntriesRequest {
    term: number;
    leaderId: number;
    prevLogIndex: number;
    prevLogTerm: number;
    entries: Array<RaftLog>;
    leaderCommitIndex: number;
}

export interface RaftNode {
    id: number;
    address: string;
    port: number;
}

export interface RaftRpc {
    start(config: RaftConfig): void;

    rpcRequestVote(to: RaftNode, data: RequestVoteRequest): void;

    rpcAppendEntries(to: RaftNode, data: AppendEntriesRequest): void;

    end(): void;
}

export declare interface RaftRpc {
    on(event: 'onRpcRequestVoteRequest', listener: (res: RequestVoteRequest) => void): this;

    on(event: 'onRpcRequestVoteResponse', listener: (res: RequestVoteResponse) => void): this;

    on(event: 'onRpcAppendEntriesRequest', listener: (res: AppendEntriesRequest) => void): this;

    on(event: 'onRpcAppendEntriesResponse', listener: (res: AppendEntriesResponse) => void): this;
}

export class RaftServer {
    //----Persistent State----
    currentTerm: number = 0;
    votedFor: number = 0;
    log: Array<Object> = [];
    //----Volatile State----
    commitIndex = 0;
    lastApplied = 0;
    //----Volatile State On Leaders----
    nextIndex: Array<number> = [];
    matchIndex: Array<number> = [];
    //----Config And Other----
    raftRpc: RaftRpc;
    config: RaftConfig;

    constructor(raftRpc: RaftRpc, config: RaftConfig) {
        this.raftRpc = raftRpc;
        this.config = config;
        const rpc = this.raftRpc;
        rpc.on('onRpcRequestVoteRequest', (data) => this.onRpcRequestVoteRequest(data));
        rpc.on('onRpcRequestVoteResponse', (data) => this.onRpcRequestVoteResponse(data));
        rpc.on('onRpcAppendEntriesRequest', (data) => this.onRpcAppendEntriesRequest(data));
        rpc.on('onRpcAppendEntriesResponse', (data) => this.onRpcAppendEntriesResponse(data));
    }

    start() {
        this.raftRpc.start(this.config);
    }

    end() {
        this.raftRpc.end();
    }

    loopOfLeader() {

    }

    loopOfFollower() {

    }

    private onRpcRequestVoteRequest(req: RequestVoteRequest) {

    }

    private onRpcRequestVoteResponse(res: RequestVoteResponse) {

    }

    private onRpcAppendEntriesRequest(req: AppendEntriesRequest) {

    }

    private onRpcAppendEntriesResponse(res: AppendEntriesResponse) {

    }
}

