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

interface RaftRequest {
    term: number;
}

export interface RequestVoteResponse extends RaftRequest {
    voteGranted: boolean;
}

export interface AppendEntriesResponse extends RaftRequest {
    success: boolean;
}

export interface RequestVoteRequest extends RaftRequest {
    candidateId: number;
    lastLogIndex: number;
    lastLogTerm: number;
}

export interface AppendEntriesRequest extends RaftRequest {
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

type _Map<T> = {
    [index in RaftRole]: T;
};

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

    roleBehaviors: _Map<BaseRoleBehavior>;

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
        this.roleBehaviors = {
            "0": new FollowerBehavior(this),
            "1": new CandidateBehavior(this),
            "2": new LeaderBehavior(this)
        }
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
        this.nowBehavior.loop();
    }

    get lastLogTerm() {
        return this.lastLog?.term ?? 0;
    }

    get lastLogIndex() {
        return this.lastLog?.index ?? 0;
    }

    get lastLog(): RaftLog | null {
        return this.log.length > 0 ? this.log[this.log.length - 1] : null;
    }

    get nowBehavior(): BaseRoleBehavior {
        return this.roleBehaviors[this.role];
    }

    logMe(msg: string): void {
        let date = new Date(Math.floor(this.now()));
        let nowStr = date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds() + ":" + date.getMilliseconds();
        console.log(`${nowStr}: \x1b[${41 + this.config.myId};30m[server:${this.config.myId} role:${RaftRole[this.role]} term:${this.currentTerm}]\x1b[0m:` + msg);
    }

    private randOf(max: number) {
        return Math.random() * max;
    }

    private roleCheckLoop(action: Function) {
        for (let i = 0; i < 3; ++i) {
            let lastRole = this.role;
            action();
            let nowRole = this.role;
            if (nowRole === lastRole) break;
        }
    }

    private onRpcRequestVoteRequest(req: RequestVoteRequest, from: RaftNode) {
        this.roleCheckLoop(() => this.nowBehavior.onRpcRequestVoteRequest(req, from));
    }

    private onRpcRequestVoteResponse(res: RequestVoteResponse, from: RaftNode) {
        this.roleCheckLoop(() => this.nowBehavior.onRpcRequestVoteResponse(res, from));
    }

    private onRpcAppendEntriesRequest(req: AppendEntriesRequest, from: RaftNode) {
        this.roleCheckLoop(() => this.nowBehavior.onRpcAppendEntriesRequest(req, from));
    }

    private onRpcAppendEntriesResponse(res: AppendEntriesResponse, from: RaftNode) {
        this.roleCheckLoop(() => this.nowBehavior.onRpcAppendEntriesResponse(res, from));
    }

    becomeFollower() {
        this.role = RaftRole.Follower;
        this._timestampOfLeaderHeart = this.now() + this.randOf(this.config.timerConfig.timeoutOfNoLeaderHeart);
    }
}

abstract class BaseRoleBehavior {
    _this: RaftServer;

    public constructor(_this: RaftServer) {
        this._this = _this;
    }

    public abstract loop(): void;

    onRpcRequestVoteRequest(req: RequestVoteRequest, from: RaftNode): void {
        this.updateTerm(req);
    }

    onRpcRequestVoteResponse(res: RequestVoteResponse, from: RaftNode): void {
        this.updateTerm(res);
    }

    onRpcAppendEntriesRequest(req: AppendEntriesRequest, from: RaftNode): void {
        this.updateTerm(req);
    }

    onRpcAppendEntriesResponse(res: AppendEntriesResponse, from: RaftNode): void {
        this.updateTerm(res);
    }

    private updateTerm(data: RaftRequest) {
        let _this = this._this;
        if (data.term > _this.currentTerm) {
            _this.logMe("my term < " + data.term + " I gonna be Follower");
            _this.votedFor = -1;
            _this.currentTerm = data.term;
            _this.becomeFollower();
        }
    }
}

class FollowerBehavior extends BaseRoleBehavior {
    loop(): void {
        let _this = this._this;
        let timerConfig = _this.config.timerConfig;
        if (_this.now() - _this._timestampOfLeaderHeart > timerConfig.timeoutOfNoLeaderHeart) {
            _this.logMe("No Leader I will be Candidate");
            _this.role = RaftRole.Candidate;
            _this.currentTerm++;
            _this.whoVotedMe.clear();
            _this._timestampOfBecomeCandidate = _this.now();
            for (const node of _this.otherNode)
                _this.raftRpc.rpcRequestVote(node, {
                    candidateId: _this.myId,
                    lastLogIndex: _this.lastLogIndex,
                    lastLogTerm: _this.lastLogTerm,
                    term: _this.currentTerm
                })
        }
    }

    onRpcRequestVoteRequest(req: RequestVoteRequest, from: RaftNode) {
        super.onRpcRequestVoteRequest(req, from);
        let _this = this._this;
        _this.logMe("recv RequestVote From server:" + from.id);
        if (_this.role === RaftRole.Follower) {
            if (_this.votedFor === -1
                && _this.currentTerm <= req.term
                && _this.lastLogIndex <= req.lastLogIndex
                && _this.lastLogTerm <= req.lastLogTerm) {
                _this.votedFor = from.id;
                _this.raftRpc.rpcRtnRequestVote(from, {voteGranted: true, term: _this.currentTerm})
            } else {
                _this.raftRpc.rpcRtnRequestVote(from, {voteGranted: false, term: _this.currentTerm})
            }
        }
    }

    onRpcAppendEntriesRequest(req: AppendEntriesRequest, from: RaftNode) {
        super.onRpcAppendEntriesRequest(req, from);
        let _this = this._this;
        if (req.entries.length == 0) {
            _this._timestampOfLeaderHeart = _this.now();
            _this.votedFor = -1;
        }
        _this.currentTerm = req.term;
    }
}

class CandidateBehavior extends BaseRoleBehavior {
    loop(): void {
        let _this = this._this;
        let timerConfig = _this.config.timerConfig;
        if (_this.now() - _this._timestampOfBecomeCandidate > timerConfig.timeoutOfNoLeaderElected) {
            _this.logMe("No Election Winner I will be Follower");
            _this.becomeFollower();
        }
    }


    onRpcRequestVoteResponse(res: RequestVoteResponse, from: RaftNode) {
        super.onRpcRequestVoteResponse(res, from);
        let _this = this._this;
        if (_this.role !== RaftRole.Candidate) return
        if (res.voteGranted) {
            _this.whoVotedMe.add(from.id);
            if (_this.whoVotedMe.size >= _this.otherNode.length / 2) {
                _this.logMe("I Get Enough Vote :" + [..._this.whoVotedMe.values()]);
                _this.role = RaftRole.Leader;
            }
        }
    }

    onRpcAppendEntriesRequest(req: AppendEntriesRequest, from: RaftNode) {
        super.onRpcAppendEntriesRequest(req, from);
        let _this = this._this;
        if (req.term >= _this.currentTerm) {
            _this.logMe("Found Leader, I gonna be Follower");
            _this.becomeFollower();
        }
    }
}

class LeaderBehavior extends BaseRoleBehavior {
    loop(): void {
        let _this = this._this;
        let timerConfig = _this.config.timerConfig;
        if (_this.now() - _this._timestampOfLeaderHeartLastSend > timerConfig.coldTimeOfLeaderHeart) {
            _this._timestampOfLeaderHeartLastSend = _this.now();
            for (const node of _this.otherNode) _this.raftRpc.rpcAppendEntries(node, {
                entries: [],
                leaderCommitIndex: _this.commitIndex,
                leaderId: _this.myId,
                prevLogIndex: _this.lastLogIndex,
                prevLogTerm: _this.lastLogTerm,
                term: _this.currentTerm
            });
        }
    }

}
