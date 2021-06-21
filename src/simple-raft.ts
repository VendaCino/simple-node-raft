export enum RaftRole {
    Follower, Candidate, Leader
}

export class RaftConstant {
    static eventVoteReq = 'onRpcRequestVoteRequest';
    static eventVoteRes = 'onRpcRequestVoteResponse';
    static eventAppendReq = 'onRpcAppendEntriesRequest';
    static eventAppendRes = 'onRpcAppendEntriesResponse';
}

export interface RaftTimerConfig {
    timeoutOfNoLeaderHeart: number;
    timeoutOfNoLeaderElected: number;
    coldTimeOfLeaderHeart: number;
}

export function makeDefaultRaftTimerConfig(rtt: number): RaftTimerConfig {
    return {
        coldTimeOfLeaderHeart: 2 * rtt,
        timeoutOfNoLeaderHeart: 5 * rtt,
        timeoutOfNoLeaderElected: 10 * rtt
    }
}

export interface RaftConfig {
    myId: number;
    nodes: Array<RaftNode>;
    timerConfig: RaftTimerConfig;
}

export interface RaftLog {
    index: number;
    term: number;
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
    start(): void;

    rpcRequestVote(to: RaftNode, data: RequestVoteRequest): void;

    rpcAppendEntries(to: RaftNode, data: AppendEntriesRequest): void;

    rpcRtnRequestVote(to: RaftNode, data: RequestVoteResponse): void;

    rpcRtnAppendEntries(to: RaftNode, data: AppendEntriesResponse): void;

    end(): void;
}

export declare interface RaftRpc {
    on(event: 'onRpcRequestVoteRequest', listener: (res: RequestVoteRequest, from: RaftNode) => void): this;

    on(event: 'onRpcRequestVoteResponse', listener: (res: RequestVoteResponse, from: RaftNode) => void): this;

    on(event: 'onRpcAppendEntriesRequest', listener: (res: AppendEntriesRequest, from: RaftNode) => void): this;

    on(event: 'onRpcAppendEntriesResponse', listener: (res: AppendEntriesResponse, from: RaftNode) => void): this;
}

export class RaftServer {
    //----Persistent State----
    currentTerm: number = 0;
    votedFor: number = -1;
    log: Array<RaftLog> = [];
    //----Volatile State----
    commitIndex = 0;
    lastApplied = 0;
    //----Volatile State On Leaders----
    nextIndex: Array<number> = [];
    matchIndex: Array<number> = [];
    //----Volatile State On Candidate----
    whoVotedMe: Set<number> = new Set();
    //----Private State------
    otherNode: Array<RaftNode> = [];
    role: RaftRole = RaftRole.Follower;
    _timestampOfLeaderHeart = this.now();
    _timestampOfBecomeCandidate = this.now();
    _timestampOfLeaderHeartLastSend = this.now();
    //----Config And Other----
    myId = -1;
    raftRpc: RaftRpc;
    config: RaftConfig;
    private _interval: NodeJS.Timeout | undefined;

    constructor(raftRpc: RaftRpc, config: RaftConfig) {
        this.raftRpc = raftRpc;
        this.config = config;
        this.myId = this.config.myId;
        this.otherNode = this.config.nodes.filter(e => e.id !== this.myId);
        const rpc = this.raftRpc;
        rpc.on('onRpcRequestVoteRequest', this.onRpcRequestVoteRequest.bind(this));
        rpc.on('onRpcRequestVoteResponse', this.onRpcRequestVoteResponse.bind(this));
        rpc.on('onRpcAppendEntriesRequest', this.onRpcAppendEntriesRequest.bind(this));
        rpc.on('onRpcAppendEntriesResponse', this.onRpcAppendEntriesResponse.bind(this));
    }

    now(): number {
        return Date.now();
    }

    start() {
        this.raftRpc.start();
        this._interval = setInterval(() => this.loop(), 25);
    }

    end() {
        this.raftRpc.end();
        if (this._interval) clearInterval(this._interval)
    }


    loop() {
        if (this.role === RaftRole.Follower) this.loopOfFollower();
        else if (this.role === RaftRole.Leader) this.loopOfLeader();
        else if (this.role === RaftRole.Candidate) this.loopOfCandidate();
        else throw Error("Wrong Role " + this.role);
    }

    loopOfLeader() {
        let timerConfig = this.config.timerConfig;
        if (this.now() - this._timestampOfLeaderHeartLastSend > timerConfig.coldTimeOfLeaderHeart) {
            this._timestampOfLeaderHeartLastSend = this.now();
            for (const node of this.otherNode) this.raftRpc.rpcAppendEntries(node, {
                entries: [],
                leaderCommitIndex: this.commitIndex,
                leaderId: this.myId,
                prevLogIndex: this.lastLogIndex,
                prevLogTerm: this.lastLogTerm,
                term: this.currentTerm
            });
        }
    }

    loopOfFollower() {
        let timerConfig = this.config.timerConfig;
        if (this.now() - this._timestampOfLeaderHeart > timerConfig.timeoutOfNoLeaderHeart) {
            this.logMe("No Leader I will be Candidate");
            this.role = RaftRole.Candidate;
            this.currentTerm++;
            this.whoVotedMe.clear();
            this._timestampOfBecomeCandidate = this.now();
            for (const node of this.otherNode)
                this.raftRpc.rpcRequestVote(node, {
                    candidateId: this.myId,
                    lastLogIndex: this.lastLogIndex,
                    lastLogTerm: this.lastLogTerm,
                    term: this.currentTerm
                })

        }
    }


    private get lastLogTerm() {
        return this.lastLog?.term ?? 0;
    }

    private get lastLogIndex() {
        return this.lastLog?.index ?? 0;
    }

    get lastLog(): RaftLog | null {
        return this.log.length > 0 ? this.log[this.log.length - 1] : null;
    }


    private logMe(msg: string): void {
        let date = new Date(Math.floor(this.now()));
        let nowStr = date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds() + ":" + date.getMilliseconds();
        console.log(`${nowStr}: \x1b[${41 + this.config.myId};30m[server:${this.config.myId} role:${RaftRole[this.role]} term:${this.currentTerm}]\x1b[0m:` + msg);
    }

    loopOfCandidate() {
        let timerConfig = this.config.timerConfig;
        if (this.now() - this._timestampOfBecomeCandidate > timerConfig.timeoutOfNoLeaderElected) {
            this.logMe("No Election Winner I will be Follower");
            this._timestampOfLeaderHeart = this.now() + this.randOf(timerConfig.timeoutOfNoLeaderHeart);
            this.role = RaftRole.Follower;
        }
    }


    private randOf(max: number) {
        return Math.random() * max;
    }

    private onRpcRequestVoteRequest(req: RequestVoteRequest, from: RaftNode) {
        this.logMe("recv RequestVote From server:" + from.id);
        if (this.role === RaftRole.Follower) {
            if (this.votedFor === -1 && this.lastLogIndex <= req.lastLogIndex && this.lastLogTerm <= req.lastLogTerm) {
                this.raftRpc.rpcRtnRequestVote(from, {success: true, term: this.currentTerm})
                this.votedFor = from.id;
            }
        }
    }

    private onRpcRequestVoteResponse(res: RequestVoteResponse, from: RaftNode) {
        if (this.role !== RaftRole.Candidate) return
        if (res.success) {
            this.whoVotedMe.add(from.id);
            if (this.whoVotedMe.size >= this.otherNode.length / 2) {
                this.logMe("I Get Enough Vote :" + [...this.whoVotedMe.values()]);
                this.role = RaftRole.Leader;
            }
        }
    }

    private onRpcAppendEntriesRequest(req: AppendEntriesRequest, from: RaftNode) {
        this._timestampOfLeaderHeart = this.now();
        this.votedFor = -1;
        this.currentTerm = req.term;
    }

    private onRpcAppendEntriesResponse(res: AppendEntriesResponse, from: RaftNode) {

    }
}

