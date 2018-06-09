import { green, red, yellow } from "colors";
import * as sh from "shelljs";
import * as node_fs from "fs";
import * as cluster from "cluster";
import { exec } from "child_process";

type WorkResult = {
    directory: string;
    result: "ERROR" | "SUCCESS";
};

export function startMaster(
    commandToExecute: string,
    directoriesToUse: string[],
    allowFailures = false,
    aSynchronous = false
): Promise<{ directoriesSucces: string[]; directoriesFailed: string[] }> {
    return new Promise(resolve => {
        let directoriesToDo = directoriesToUse.length;
        const directoriesSucces: string[] = [];
        const directoriesFailed: string[] = [];

        if (aSynchronous) while (startWorker()) {}
        else startWorker();

        cluster.on("message", (worker: cluster.Worker, message: WorkResult) => {
            worker.kill();
            directoriesToDo--;

            message.result === "SUCCESS"
                ? directoriesSucces.push(message.directory)
                : directoriesFailed.push(message.directory);

            // No more directories or we there is a failure and we don't allow any? Resolve!
            if (!directoriesToDo || (!allowFailures && directoriesFailed.length)) {
                resolve({ directoriesSucces, directoriesFailed });
            } else {
                startWorker();
            }
        });
    });

    /**
     * Returns if there was a worker started
     */
    function startWorker() {
        return !!directoriesToUse.length && cluster.fork({ commandToExecute, directory: directoriesToUse.shift() });
    }
}

function executeWork(commandToExecute: string, directory: string) {
    const result: WorkResult = { directory, result: "SUCCESS" };

    try {
        node_fs.accessSync(directory, node_fs.constants.F_OK & node_fs.constants.R_OK);
    } catch (e) {
        process.stdout.write(red(`ERROR: Could not access path "${directory}"`));
        result.result = "ERROR";

        process.stdout.write("\n\n");
        process.send!(result);
        process.exit(1);
    }

    sh.cd(directory);

    console.log(yellow(`Executing command "${commandToExecute}" in: ${directory}`));

    const child = exec(commandToExecute);

    child.stdout.on("data", text => {
        process.stdout.write(text);
    });

    child.stderr.on("data", error => {
        result.result = "ERROR";
        console.error(red(`Error when executing "${commandToExecute}" in: ${directory}`));
        process.stdout.write(error);
    });

    // Use stderr.on("end") since it's always being called last, which is not the case for stdout.on("end")
    child.stderr.on("end", () => {
        result.result === "SUCCESS"
            ? process.stdout.write(green("Done"))
            : process.stdout.write(red("Done with errors"));

        process.stdout.write("\n\n");
        process.send!(result);
    });
}

if (cluster.isWorker) {
    executeWork(process.env.commandToExecute, process.env.directory);
}