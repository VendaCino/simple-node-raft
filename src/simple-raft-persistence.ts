import {RaftLog, RaftPersistence, zeroLog} from "./simple-raft";

export class InMemRaftPersistence implements RaftPersistence {
    currentTerm: number = 0;
    log: Array<RaftLog> = [zeroLog];
    votedFor: number = -1;

    get lastLog(): RaftLog {
        return this.log.length > 0 ? this.log[this.log.length - 1] : zeroLog;
    }

    getEntries(startIndex: number, endIndex?: number): Array<RaftLog> {
        return this.log.slice(startIndex, endIndex);
    }

    getLog(index: number, term?: number): RaftLog {
        return this.log[index];
    }

    push(log: RaftLog): boolean {
        if (this.log[log.index] === undefined) {
            this.log[log.index] = log;
            return true;
        } else return false;
    }

    remove(startIndex: number): void {
        this.log = this.log.slice(0, startIndex);
    }

}
