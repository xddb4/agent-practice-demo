// Stable CLI entry used by npm and Docker. See src/app/assets.mjs for resource order.
import { generateWorkspace } from './tools/build-workspace.mjs';

const result = await generateWorkspace();
console.log(`Generated ${result.files.length} workspace resources.`);
