# autocannon
## Overview

**autocannon** is a high-performance HTTP benchmarking tool designed to test the throughput and latency of your web servers. It allows developers to simulate multiple concurrent connections and requests, providing detailed statistics to help optimize server performance.

## Features

- Fast and lightweight HTTP benchmarking
- Supports HTTP/1.1, HTTP/2, and HTTPS
- Configurable number of connections and requests
- Detailed latency and throughput statistics
- JSON and human-readable output formats
- Supports custom headers, payloads, and request methods
- Can be used as a CLI tool or programmatically as a Node.js module

## Installation

### Using npm

```bash
npm install -g autocannon
```

### Using yarn

```bash
yarn global add autocannon
```

## Usage

### Command Line

```bash
autocannon -c 100 -d 40 -p 10 http://localhost:3000
```

- `-c`: Number of concurrent connections (default: 10)
- `-d`: Duration of the test in seconds (default: 10)
- `-p`: Number of pipelined requests (default: 1)

#### Example with custom headers and POST data

```bash
autocannon -c 50 -d 20 -m POST -H "Authorization: Bearer <token>" -b '{"key":"value"}' http://localhost:3000/api
```

### Programmatic Usage

```js
const autocannon = require('autocannon')

autocannon({
    url: 'http://localhost:3000',
    connections: 100,
    duration: 20
}, console.log)
```

## Output

Autocannon provides a summary including:

- Requests per second
- Latency (average, min, max, p99)
- Throughput (bytes/sec)
- Error rates

You can also output results as JSON for further processing:

```bash
autocannon -j http://localhost:3000 > results.json
```

## API

See the [official documentation](https://github.com/mcollina/autocannon#api) for full API details.

## Best Practices

- Run benchmarks on the same network as your server to avoid network bottlenecks.
- Use a dedicated machine for benchmarking to avoid resource contention.
- Run multiple tests and average the results for accuracy.

## Contributing

Contributions are welcome! Please open issues or submit pull requests on [GitHub](https://github.com/mcollina/autocannon).

## License

This project is licensed under the MIT License.