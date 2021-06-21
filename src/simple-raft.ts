import {InMemRaftPersistence} from "./simple-raft-persistence";

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
    key: string;
    data: Object;
}

export const zeroLog: RaftLog = {
    data: {}, index: 0, key: "", term: 0
}

interface RaftRequest {
    term: number;
}

export interface RequestVoteResponse extends RaftRequest {
    voteGranted: boolean;
}

export interface AppendEntriesResponse extends RaftRequest {
    success: boolean;
    matchIndex: number;
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

type _RoleMap<T> = {
    [index in RaftRole]: T;
};

export interface RaftPersistence {
    currentTerm: number;
    votedFor: number;
    readonly log: Array<RaftLog>;
    readonly lastLog: RaftLog;

    getLog(index: number, term?: number): RaftLog | null;

    push(log: RaftLog[]): Promise<boolean>;

    remove(startIndex: number): Promise<void>;

    getEntries(startIndex: number, endIndex?: number): Array<RaftLog>;
}

export class RaftServer {
    //----Persistent State----
    // currentTerm: number = 0;
    // votedFor: number = -1;
    // log: Array<RaftLog> = [];
    persis: RaftPersistence;
    //----Volatile State----
    commitIndex = 0;
    lastApplied = 0;
    //----Volatile State On Leaders----
    nextIndex: Map<number, number> = new Map();
    matchIndex: Map<number, number> = new Map();
    logIndexResolve: Map<number, (value: Boolean | PromiseLike<Boolean>) => void> = new Map();
    //----Volatile State On Candidate----
    whoVotedMe: Set<number> = new Set();
    //----Private State------
    otherNode: Array<RaftNode> = [];
    role: RaftRole = RaftRole.Follower;
    _timestampOfLeaderHeart = this.now() - this.randOf(5);
    _timestampOfBecomeCandidate = this.now();
    _timestampOfLeaderHeartLastSend = this.now();
    //----Config And Other----
    myId = -1;
    raftRpc: RaftRpc;
    config: RaftConfig;
    private _interval: NodeJS.Timeout | undefined;

    roleBehaviors: _RoleMap<BaseRoleBehavior>;

    constructor(raftRpc: RaftRpc, config: RaftConfig, raftPersistence?: RaftPersistence) {
        this.persis = raftPersistence ?? new InMemRaftPersistence();
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

    //---persis properties---
    get votedFor() {
        return this.persis.votedFor;
    }

    set votedFor(value: number) {
        this.persis.votedFor = value;
    }

    get currentTerm() {
        return this.persis.currentTerm;
    }

    set currentTerm(value: number) {
        this.persis.currentTerm = value;
    }

    //---persis properties end---


    now(): number {
        return Date.now();
    }

    start() {
        this.becomeFollower();
        this.raftRpc.start();
        this._interval = setInterval(() => this.loop(), 25);
    }

    end() {
        this.clearAllUnResolve();
        this.raftRpc.end();
        if (this._interval) clearInterval(this._interval)
    }

    loop() {
        this.nowBehavior.loop();
    }

    get lastLog(): RaftLog {
        return this.persis.lastLog;
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

    becomeCandidate() {
        if (this.role === RaftRole.Follower) {
            this.role = RaftRole.Candidate;
            this.votedFor = this.myId;
        }
    }

    becomeLeader() {
        this.role = RaftRole.Leader;
        this.nextIndex = new Map();
        let index = this.lastLog.index + 1;
        for (let node of this.otherNode) this.nextIndex.set(node.id, index);
        this.matchIndex = new Map();
        this.clearAllUnResolve();
        this._timestampOfLeaderHeartLastSend = -1;
    }

    async submitLog(key: string, data: Object): Promise<Boolean> {
        if (this.role === RaftRole.Leader) {
            let index = this.lastLog.index + 1;
            let rr: Promise<Boolean> = new Promise((resolve => this.logIndexResolve.set(index, resolve)));
            await this.persis.push([{data: data, index: index, key: key, term: this.currentTerm}]);
            return rr;
        } else return false;
    }

    private clearAllUnResolve(): void {
        for (let value of this.logIndexResolve.values()) {
            value(false);
        }
        this.logIndexResolve.clear();
    }

    async commit(index: number) {
        if (index === 0) return;
        let raftLog = this.persis.getLog(index);
        this.logMe(`I commit a log index:${index} data: ${JSON.stringify(raftLog)}`);
        if (this.logIndexResolve.has(index)) this.logIndexResolve.get(index)!(true);
        return;
    }

}

abstract class BaseRoleBehavior {
    _this: RaftServer;

    public constructor(_this: RaftServer) {
        this._this = _this;
    }

    public loop() {
        let _this = this._this;
        if (_this.commitIndex > _this.lastApplied) {
            _this.commit(_this.lastApplied + 1).then(() => _this.lastApplied++);
        }
    }

    onRpcRequestVoteRequest(req: RequestVoteRequest, from: RaftNode): void {
        this.updateTerm(req, from, "reqVote");
    }

    onRpcRequestVoteResponse(res: RequestVoteResponse, from: RaftNode): void {
        this.updateTerm(res, from, "resVote");
    }

    onRpcAppendEntriesRequest(req: AppendEntriesRequest, from: RaftNode): void {
        this.updateTerm(req, from, "reqLog");
    }

    onRpcAppendEntriesResponse(res: AppendEntriesResponse, from: RaftNode): void {
        this.updateTerm(res, from, "resLog");
    }

    private updateTerm(data: RaftRequest, from: RaftNode, tag?: string) {
        let _this = this._this;
        if (data.term > _this.currentTerm) {
            _this.logMe("my term < " + data.term + " I gonna be Follower. " + `from:${from.id} tag:${tag}`);
            _this.votedFor = -1;
            _this.currentTerm = data.term;
            _this.becomeFollower();
        }
    }
}

class FollowerBehavior extends BaseRoleBehavior {
    loop(): void {
        super.loop();
        let _this = this._this;
        let timerConfig = _this.config.timerConfig;
        if (_this.now() - _this._timestampOfLeaderHeart > timerConfig.timeoutOfNoLeaderHeart) {
            _this.logMe("No Leader I will be Candidate");
            _this.becomeCandidate();
            _this.currentTerm++;
            _this.whoVotedMe.clear();
            _this._timestampOfBecomeCandidate = _this.now();
            for (const node of _this.otherNode)
                _this.raftRpc.rpcRequestVote(node, {
                    candidateId: _this.myId,
                    lastLogIndex: _this.lastLog.index,
                    lastLogTerm: _this.lastLog.term,
                    term: _this.currentTerm
                })
        }
    }

    onRpcRequestVoteRequest(req: RequestVoteRequest, from: RaftNode) {
        super.onRpcRequestVoteRequest(req, from);
        let _this = this._this;
        _this.logMe("recv RequestVote From server:" + from.id + `\x1b[30;30m data:${JSON.stringify(req)}\x1b[0m`);
        if (_this.role === RaftRole.Follower) {
            if (_this.votedFor === -1
                && _this.currentTerm <= req.term
                && _this.lastLog.index <= req.lastLogIndex
                && _this.lastLog.term <= req.lastLogTerm) {
                _this.votedFor = from.id;
                _this.raftRpc.rpcRtnRequestVote(from, {voteGranted: true, term: _this.currentTerm})
            } else {
                _this.raftRpc.rpcRtnRequestVote(from, {voteGranted: false, term: _this.currentTerm})
            }
        }
    }

    private onProcessingAppendEntriesRequest = false;
    onRpcAppendEntriesRequest(req: AppendEntriesRequest, from: RaftNode) {
        super.onRpcAppendEntriesRequest(req, from);
        let _this = this._this;
        if (req.term < _this.currentTerm) {
            _this.raftRpc.rpcRtnAppendEntries(from, {matchIndex: 0, success: false, term: _this.currentTerm});
            return;
        }
        //heart ignore
        _this._timestampOfLeaderHeart = _this.now();
        if (req.entries.length === 0) return;

        if (this.onProcessingAppendEntriesRequest) return;
        this.onProcessingAppendEntriesRequest = true;
        let matchLogs = _this.persis.getLog(req.prevLogIndex, req.term);
        if (matchLogs === null) {
            _this.logMe(`I get Log bug but no match ` + `\x1b[30;30m data:${JSON.stringify(req)}\x1b[0m`);
            _this.raftRpc.rpcRtnAppendEntries(from, {matchIndex: 0, success: false, term: _this.currentTerm});
            let indexSameLogs = _this.persis.getLog(req.prevLogIndex);
            if (indexSameLogs != null) {
                _this.logMe(`I clear my old log ${indexSameLogs.index}`);
                _this.persis.remove(indexSameLogs.index).then(() => this.onProcessingAppendEntriesRequest = false);
            }
            return;
        } else {
            _this.logMe(`I add new log ` + `\x1b[30;30m entries:${JSON.stringify(req.entries)}\x1b[0m`);
            _this.persis.push(req.entries).then(() => {
                this.onProcessingAppendEntriesRequest = false;
                if (req.leaderCommitIndex > _this.commitIndex) {
                    _this.commitIndex = Math.min(req.leaderCommitIndex, _this.lastLog.index);
                }
                _this.raftRpc.rpcRtnAppendEntries(from, {
                    matchIndex: _this.lastLog.index,
                    success: true,
                    term: _this.currentTerm
                });
            })
        }

    }
}

class CandidateBehavior extends BaseRoleBehavior {
    loop(): void {
        super.loop();
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
            _this.logMe("I Get Vote from :" + from.id);
            _this.whoVotedMe.add(from.id);
            if (_this.whoVotedMe.size >= _this.otherNode.length / 2) {
                _this.logMe("I Get Enough Vote :" + [..._this.whoVotedMe.values()]);
                _this.becomeLeader();
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
        super.loop();
        let _this = this._this;
        let timerConfig = _this.config.timerConfig;
        if (_this.now() - _this._timestampOfLeaderHeartLastSend > timerConfig.coldTimeOfLeaderHeart) {
            _this._timestampOfLeaderHeartLastSend = _this.now();
            for (let node of _this.otherNode) {
                let prevIndex = (_this.nextIndex.get(node.id) ?? 1) - 1;
                let prevLog = _this.persis.getLog(prevIndex)!;
                let entries = _this.persis.getEntries(prevIndex + 1);
                if (entries.length > 0)
                    _this.logMe(`I send log to ${node.id} logLength:${entries.length} prev:${JSON.stringify(prevLog)}`);
                _this.raftRpc.rpcAppendEntries(node, {
                    entries: entries,
                    leaderCommitIndex: _this.commitIndex,
                    leaderId: _this.myId,
                    prevLogIndex: prevLog.index,
                    prevLogTerm: prevLog.term,
                    term: _this.currentTerm
                });
            }
        }

        //majority commit
        let count = 0;
        let min = -1;
        for (const value of _this.matchIndex.values()) {
            if (value > _this.commitIndex) {
                count++;
                min = Math.min(value, min === -1 ? value : min);
            }
        }
        if (count >= _this.otherNode.length / 2) {
            if (_this.persis.getLog(min, _this.currentTerm) !== null) {
                _this.commitIndex = min
            } else {
                _this.commitIndex = min;
            }
        }
    }


    onRpcAppendEntriesResponse(res: AppendEntriesResponse, from: RaftNode) {
        super.onRpcAppendEntriesResponse(res, from);
        let _this = this._this;
        if (_this.role !== RaftRole.Leader) return;
        let formId = from.id;
        if (res.success) {
            _this.matchIndex.set(formId, res.matchIndex);
            _this.nextIndex.set(formId, res.matchIndex + 1);
        } else {
            _this.nextIndex.set(formId, (_this.nextIndex.get(formId) ?? 1) - 1);
        }
    }
}
