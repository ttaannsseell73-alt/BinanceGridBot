import fs from 'fs';
import path from 'path';
import { QuantModel } from '../strategy/QuantEngine';

export type QuantModelSource = 'RUNTIME' | 'RUNTIME_BACKUP' | 'BASE';

export interface QuantModelCandidate {
  modelPath: string;
  source: QuantModelSource;
  model: QuantModel;
}

export class QuantModelStore {
  private readonly backupPath: string;

  constructor(
    private readonly runtimePath: string,
    private readonly basePath: string
  ) {
    this.backupPath = `${runtimePath}.bak`;
  }

  public getRuntimePath(): string {
    return this.runtimePath;
  }

  public getBasePath(): string {
    return this.basePath;
  }

  public loadCandidates(): QuantModelCandidate[] {
    const candidates: Array<[string, QuantModelSource]> = [
      [this.runtimePath, 'RUNTIME'],
      [this.backupPath, 'RUNTIME_BACKUP'],
      [this.basePath, 'BASE']
    ];

    const loaded: QuantModelCandidate[] = [];

    for (const [modelPath, source] of candidates) {
      if (!fs.existsSync(modelPath)) continue;

      try {
        const raw = fs.readFileSync(modelPath, 'utf8');
        const model = JSON.parse(raw) as QuantModel;

        if (
          !model ||
          (model.version !== 1 && model.version !== 2) ||
          !Array.isArray(model.observations)
        ) {
          continue;
        }

        loaded.push({ modelPath, source, model });
      } catch {
        // The caller can safely fall through to backup/base.
      }
    }

    return loaded;
  }

  public saveRuntime(model: QuantModel): void {
    const dir = path.dirname(this.runtimePath);
    fs.mkdirSync(dir, { recursive: true });

    const tempPath = `${this.runtimePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(model), 'utf8');

    try {
      if (fs.existsSync(this.runtimePath)) {
        fs.copyFileSync(this.runtimePath, this.backupPath);
      }

      try {
        fs.renameSync(tempPath, this.runtimePath);
      } catch {
        // Windows can reject replacing an existing destination via rename.
        // A validated backup already exists at this point.
        fs.rmSync(this.runtimePath, { force: true });
        fs.renameSync(tempPath, this.runtimePath);
      }
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { force: true });
      }
    }
  }
}
