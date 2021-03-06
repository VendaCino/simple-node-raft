import {RaftLog, RaftPersistence, zeroLog} from "./simple-raft";

export class InMemRaftPersistence implements RaftPersistence {
    currentTerm: number = 0;
    log: Array<RaftLog> = [zeroLog];
    votedFor: number = -1;

    async setCurrentTerm(value: number): Promise<void> {
        this.currentTerm = value;
    }

    async setVoteFor(value: number): Promise<void> {
        this.votedFor = value;
    }

    get lastLog(): RaftLog {
        return this.log.length > 0 ? this.log[this.log.length - 1] : zeroLog;
    }

    getEntries(startIndex: number, endIndex?: number): Array<RaftLog> {
        return this.log.slice(startIndex, endIndex);
    }

    getLog(index: number, term?: number): RaftLog | null {
        if (term === undefined || term === null) return this.log[index];
        else {
            let raftLog = this.log[index];
            if (raftLog?.term === term) return raftLog;
            else return null;
        }
    }

    async push(logs: RaftLog[]): Promise<boolean> {
        for (let log of logs) {
            if (this.log[log.index] === undefined) {
                this.log[log.index] = log;
            } else {
                console.error("wrong index")
                return false;
            }
        }
        return true;
    }

    async remove(startIndex: number): Promise<void> {
        this.log = this.log.slice(0, startIndex);
    }

    removeSnapchatIndex(noNeedIndex: number): void {
        this.log = this.log.slice(noNeedIndex);
    }

}
