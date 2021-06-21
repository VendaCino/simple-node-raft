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

}

