export interface StudyTask {
  id: string | number;
  title: string;
  description?: string;
  date?: string;
  start?: string;
  end?: string;
  q: number;
  done?: boolean;
  agent_run_id?: string;
  proposal_index?: number;
}
export interface Evidence {
  id: string | number;
  title: string;
  dim: number;
  status: '待确认' | '已接受' | '已拒绝' | '待观察';
}
export interface StudySnapshot {
  tasks: StudyTask[];
  evidence: Evidence[];
}
