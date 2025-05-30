const express = require("express");
const autocannon = require("autocannon");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const path = require("path");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

// Command line args
const args = process.argv.slice(2);
const configPath = args[0] || "./config.json";

const app = express();
const port = 3000;

// Load config
function loadConfig() {
  try {
    const fileContent = fs.readFileSync(configPath, "utf8");
    return JSON.parse(fileContent);
  } catch (error) {
    console.error(`Error loading config: ${error.message}`);
    process.exit(1);
  }
}

// Create directories
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Generate charts for the report
async function generateCharts(result) {
  const width = 600;
  const height = 300;
  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: "white",
  });

  // Create charts directory
  const chartsDir = path.join(process.cwd(), "charts");
  ensureDirectoryExists(chartsDir);

  // Generate latency chart
  const latencyChart = {
    type: "bar",
    data: {
      labels: ["Min", "Average", "Max", "Std Dev"],
      datasets: [
        {
          label: "Latency (ms)",
          data: [
            result.latency.min,
            result.latency.average,
            result.latency.max,
            result.latency.stddev,
          ],
          backgroundColor: [
            "rgba(75, 192, 192, 0.6)",
            "rgba(54, 162, 235, 0.6)",
            "rgba(255, 99, 132, 0.6)",
            "rgba(255, 206, 86, 0.6)",
          ],
          borderColor: [
            "rgba(75, 192, 192, 1)",
            "rgba(54, 162, 235, 1)",
            "rgba(255, 99, 132, 1)",
            "rgba(255, 206, 86, 1)",
          ],
          borderWidth: 1,
        },
      ],
    },
    options: {
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Milliseconds",
          },
        },
      },
      plugins: {
        title: {
          display: true,
          text: "Latency Metrics",
        },
      },
    },
  };

  // Generate requests chart
  // Extract timeline data from autocannon result
  const timelineData = [];
  const timeLabels = [];

  // Check if we have detailed timeline data from the custom tracking
  if (
    result.requestsTimeline &&
    Object.keys(result.requestsTimeline).length > 0
  ) {
    const timeKeys = Object.keys(result.requestsTimeline).sort(
      (a, b) => parseInt(a) - parseInt(b)
    );

    timeKeys.forEach((key) => {
      timelineData.push(result.requestsTimeline[key]);
      timeLabels.push(`${key}s`);
    });
  }
  // Fallback to looking for standard autocannon timeline data
  else if (result.requests && typeof result.requests === "object") {
    // Autocannon may store timeline data with numeric keys
    const timeKeys = Object.keys(result.requests)
      .filter((key) => !isNaN(parseInt(key)))
      .sort((a, b) => parseInt(a) - parseInt(b));

    if (timeKeys.length > 0) {
      // Extract timeline data
      timeKeys.forEach((key) => {
        timelineData.push(result.requests[key]);
        timeLabels.push(`${key}s`);
      });
    }
  }

  // If no timeline data found, use a simple fallback with average values
  if (timelineData.length === 0) {
    const duration = result.duration || config.duration || 30;
    for (let i = 1; i <= duration; i++) {
      timelineData.push(result.requests.average);
      timeLabels.push(`${i}s`);
    }
  }

  const requestsChart = {
    type: "line",
    data: {
      labels: timeLabels,
      datasets: [
        {
          label: "Requests per Second",
          data: timelineData,
          fill: false,
          borderColor: "rgb(75, 192, 192)",
          tension: 0.1,
          pointRadius: 3,
          pointBackgroundColor: "rgb(75, 192, 192)",
        },
      ],
    },
    options: {
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Requests/Sec",
          },
        },
        x: {
          title: {
            display: true,
            text: "Time (seconds)",
          },
        },
      },
      plugins: {
        title: {
          display: true,
          text: "Requests Timeline",
        },
      },
    },
  };

  // Generate status codes chart if available
  let statusCodesChart = null;
  if (
    result.statusCodeStats &&
    Object.keys(result.statusCodeStats).length > 0
  ) {
    statusCodesChart = {
      type: "pie",
      data: {
        labels: Object.keys(result.statusCodeStats),
        datasets: [
          {
            data: Object.values(result.statusCodeStats),
            backgroundColor: [
              "rgba(75, 192, 192, 0.6)",
              "rgba(54, 162, 235, 0.6)",
              "rgba(255, 99, 132, 0.6)",
              "rgba(255, 206, 86, 0.6)",
              "rgba(153, 102, 255, 0.6)",
            ],
            borderWidth: 1,
          },
        ],
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: "Status Code Distribution",
          },
        },
      },
    };
  }

  // Create chart images
  const latencyImageBuffer = await chartJSNodeCanvas.renderToBuffer(
    latencyChart
  );
  const requestsImageBuffer = await chartJSNodeCanvas.renderToBuffer(
    requestsChart
  );

  const charts = {
    latency: latencyImageBuffer,
    requests: requestsImageBuffer,
  };

  if (statusCodesChart) {
    charts.statusCodes = await chartJSNodeCanvas.renderToBuffer(
      statusCodesChart
    );
  }

  return charts;
}

// Modify the generatePDF function to improve chart placement and prevent overflow
async function generatePDF(result, config, outputPath) {
  // Generate charts first
  const charts = await generateCharts(result);

  return new Promise((resolve) => {
    const doc = new PDFDocument({
      margin: 50,
      size: "A4", // Standard A4 size
      bufferPages: true, // Enable buffering for page manipulation
    });

    const writeStream = fs.createWriteStream(outputPath);

    writeStream.on("finish", () => {
      console.log(`PDF saved: ${outputPath}`);
      resolve();
    });

    doc.pipe(writeStream);

    // Function to check and add page if needed
    const checkAndAddPage = (requiredHeight) => {
      const currentY = doc.y;
      const availableSpace =
        doc.page.height - doc.page.margins.bottom - currentY;

      if (availableSpace < requiredHeight) {
        doc.addPage();
        return true;
      }
      return false;
    };

    // Header
    doc.fontSize(24).text("Autocannon Load Test Report", { align: "center" });
    doc.moveDown();
    doc
      .fontSize(14)
      .text(`Test run on ${new Date().toLocaleString()}`, { align: "center" });
    doc.moveDown(2);

    // Test config
    doc.fontSize(16).text("Test Configuration", { underline: true });
    doc.fontSize(12);
    doc.text(`URL: ${config.url}`);
    doc.text(`Method: ${config.method}`);
    doc.text(`Connections: ${config.connections}`);
    doc.text(`Duration: ${config.duration} seconds`);

    if (config.payload) {
      doc.moveDown();
      doc.text("Payload:", { underline: true });
      let payloadText = JSON.stringify(config.payload, null, 2);
      // Truncate payload if it's too large
      if (payloadText.length > 500) {
        payloadText = payloadText.substring(0, 497) + "...";
      }
      doc.text(payloadText);
    }
    doc.moveDown(2);

    // Results summary
    doc.fontSize(16).text("Test Results Summary", { underline: true });
    doc.moveDown();

    // Check space for each chart before adding
    // Add latency chart - requires ~300px
    checkAndAddPage(300);
    doc.image(charts.latency, {
      fit: [450, 225], // Smaller size to fit better
      align: "center",
    });
    doc.moveDown();

    // Add requests timeline chart - requires ~300px
    if (checkAndAddPage(300)) {
      doc
        .fontSize(16)
        .text("Test Results Summary (continued)", { underline: true });
      doc.moveDown();
    }

    doc.image(charts.requests, {
      fit: [450, 225], // Smaller size to fit better
      align: "center",
    });
    doc.moveDown();

    // Add status codes chart if available - requires ~250px
    if (charts.statusCodes) {
      if (checkAndAddPage(250)) {
        doc
          .fontSize(16)
          .text("Test Results Summary (continued)", { underline: true });
        doc.moveDown();
      }

      doc.image(charts.statusCodes, {
        fit: [350, 175], // Smaller size to fit better
        align: "center",
      });
      doc.moveDown();
    }

    // Detailed Results - always start on a new page
    doc.addPage();
    doc.fontSize(16).text("Detailed Test Results", { underline: true });

    // Latency
    doc.fontSize(14).text("Latency:");
    doc.fontSize(12);
    doc.text(`Min: ${result.latency.min} ms`);
    doc.text(`Max: ${result.latency.max} ms`);
    doc.text(`Average: ${result.latency.average.toFixed(2)} ms`);
    doc.text(`Std Dev: ${result.latency.stddev.toFixed(2)} ms`);

    // Percentiles
    if (result.latency.p1 !== undefined) {
      doc.moveDown(0.5);
      doc.text("Percentiles:");
      doc.text(`p1: ${result.latency.p1} ms`);
      doc.text(`p50: ${result.latency.p50} ms`);
      doc.text(`p75: ${result.latency.p75} ms`);
      doc.text(`p90: ${result.latency.p90} ms`);
      doc.text(`p99: ${result.latency.p99} ms`);
    }
    doc.moveDown();

    // Check if we need a new page for remaining sections
    if (doc.y > doc.page.height - 200) {
      doc.addPage();
    }

    // Requests
    doc.fontSize(14).text("Requests:");
    doc.fontSize(12);
    doc.text(`Total: ${result.requests.total}`);
    doc.text(`Average: ${result.requests.average.toFixed(2)} req/sec`);
    doc.moveDown();

    // Throughput
    doc.fontSize(14).text("Throughput:");
    doc.fontSize(12);
    doc.text(`Total: ${(result.throughput.total / 1024 / 1024).toFixed(2)} MB`);
    doc.text(
      `Average: ${(result.throughput.average / 1024).toFixed(2)} KB/sec`
    );
    doc.moveDown();

    // Check if we need a new page for errors section
    if (doc.y > doc.page.height - 150) {
      doc.addPage();
    }

    // Errors & Status Codes
    doc.fontSize(14).text("Errors and Status Codes:");
    doc.fontSize(12);
    doc.text(`Errors: ${result.errors || 0}`);

    if (result.statusCodeStats) {
      doc.moveDown(0.5);
      doc.text("Status Codes:");
      Object.entries(result.statusCodeStats).forEach(([code, count]) => {
        doc.text(`  ${code}: ${count}`);
      });
    }

    doc.end();
  });
}

// Run a single test
async function runTest(config, name) {
  console.log(`\nRunning test: ${name}`);
  console.log(`URL: ${config.url}`);
  console.log(`Method: ${config.method}`);
  console.log(`Connections: ${config.connections}`);
  console.log(`Duration: ${config.duration} seconds`);

  const testConfig = {
    url: config.url,
    method: config.method || "GET",
    headers: config.headers || {},
    body: config.payload ? JSON.stringify(config.payload) : undefined,
    connections: config.connections || 30,
    duration: config.duration || 30,
    timeout: config.timeout || 10000,
  };

  // Configuration for more detailed results
  Object.assign(testConfig, {
    excludeErrorStats: false, // Include detailed error statistics
    expectStatuses: [200], // Expected successful status codes
    renderProgressBar: true, // Show progress bar during test
    renderResultsTable: true, // Show results table after test
    latencyParams: {
      // More detailed latency params
      p1: true,
      p50: true,
      p75: true,
      p90: true,
      p99: true,
    },
  });

  // Create a global object to store requests per second data
  const requestsPerSecond = {};

  // Enable requests per second tracking at each second - FIXED VERSION
  testConfig.setupClient = (client) => {
    // Initialize requestsPerSecond counter for this client
    client.requestsPerSecond = requestsPerSecond;

    // Create a timer to track elapsed seconds
    let testStart = process.hrtime();

    client.on(
      "response",
      (clientInstance, statusCode, resBytes, responseTime) => {
        // Calculate elapsed time in seconds more reliably
        const elapsed = process.hrtime(testStart);
        const elapsedSeconds = Math.floor(elapsed[0]); // Just use whole seconds

        // Initialize counter for this second if needed
        if (!client.requestsPerSecond[elapsedSeconds]) {
          client.requestsPerSecond[elapsedSeconds] = 0;
        }

        // Increment request count for this second
        client.requestsPerSecond[elapsedSeconds]++;
      }
    );
  };

  // Run the test
  const instance = autocannon(testConfig);

  // Track the test with progress bar
  autocannon.track(instance, { renderProgressBar: true });

  // Wait for results
  const result = await instance;

  // Attach per-second request data to result
  if (Object.keys(requestsPerSecond).length > 0) {
    result.requestsTimeline = requestsPerSecond;
  }

  return { result, config: testConfig };
}

// Save test results as JSON for later analysis
async function saveTestResults(result, name, outputDir) {
  const resultsPath = path.join(
    outputDir,
    `${name.replace(/[^a-z0-9]/gi, "-")}-${Date.now()}.json`
  );
  fs.writeFileSync(resultsPath, JSON.stringify(result, null, 2));
  console.log(`Results JSON saved: ${resultsPath}`);
  return resultsPath;
}

// Main function to run all tests
async function runTests() {
  const config = loadConfig();
  const outputDir = path.join(process.cwd(), "reports");
  ensureDirectoryExists(outputDir);

  // Create a results directory for JSON results
  const resultsDir = path.join(outputDir, "json");
  ensureDirectoryExists(resultsDir);

  const testResults = [];

  // Handle different config structures
  if (config.scenarios && Array.isArray(config.scenarios)) {
    // Multiple scenarios in config
    const defaultSettings = config.defaultSettings || {};

    // Run each scenario
    for (const scenario of config.scenarios) {
      // Merge scenario with default settings
      const mergedConfig = {
        ...defaultSettings,
        ...scenario,
        headers: { ...defaultSettings.headers, ...scenario.headers },
      };

      const name = scenario.name || `Test-${new Date().getTime()}`;
      const { result } = await runTest(mergedConfig, name);

      // Save JSON results
      await saveTestResults(result, name, resultsDir);

      // Add to test results array for comparison
      testResults.push({
        name,
        result,
      });

      // Generate report
      const reportPath = path.join(
        outputDir,
        `${name.replace(/[^a-z0-9]/gi, "-")}-${Date.now()}.pdf`
      );
      await generatePDF(result, mergedConfig, reportPath);
    }

    // If multiple tests were run, generate a comparison report
    if (testResults.length > 1) {
      await generateComparisonReport(testResults, outputDir);
    }
  } else {
    // Single test configuration
    const { result, config: testConfig } = await runTest(
      config,
      "Default Test"
    );

    // Save JSON results
    const name = "Default Test";
    await saveTestResults(result, name, resultsDir);

    const reportPath = path.join(outputDir, `load-test-${Date.now()}.pdf`);
    await generatePDF(result, testConfig, reportPath);
  }

  console.log("\nAll tests completed");
}

// Generate a comparison report if multiple tests were run
async function generateComparisonReport(testResults, outputDir) {
  if (testResults.length <= 1) return;

  // Sort test results by performance (lowest latency is best)
  testResults.sort(
    (a, b) => a.result.latency.average - b.result.latency.average
  );

  // Create chart comparison using ChartJSNodeCanvas
  // Use smaller charts to fit better on the page
  const width = 600;
  const height = 300;
  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: "white",
  });

  // Prepare data for charts
  const labels = testResults.map((test) => test.name);
  const avgLatencyData = testResults.map((test) => test.result.latency.average);
  const reqPerSecData = testResults.map((test) => test.result.requests.average);

  // Color gradient for charts - green (best) to red (worst)
  const generateColorGradient = (count) => {
    const colors = [];
    for (let i = 0; i < count; i++) {
      // Calculate gradient: green for best performers, yellow for middle, red for worst
      const ratio = i / (count - 1 || 1);
      if (ratio < 0.5) {
        // Green to yellow gradient
        const greenValue = 75 + (255 - 75) * (ratio * 2);
        colors.push(`rgba(75, ${Math.round(greenValue)}, 192, 0.6)`);
      } else {
        // Yellow to red gradient
        const greenValue = 255 - 255 * ((ratio - 0.5) * 2);
        colors.push(
          `rgba(255, ${Math.round(greenValue)}, ${Math.round(
            greenValue * 0.5
          )}, 0.6)`
        );
      }
    }
    return colors;
  };

  const bgColors = generateColorGradient(testResults.length);
  const borderColors = bgColors.map((color) => color.replace("0.6", "1"));

  // Generate latency comparison chart - adjust for responsive sizing
  const latencyCompChart = {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Average Latency (ms)",
          data: avgLatencyData,
          backgroundColor: bgColors,
          borderColor: borderColors,
          borderWidth: 1,
        },
      ],
    },
    options: {
      indexAxis: "y", // Horizontal bar chart for better readability with many tests
      scales: {
        x: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Milliseconds (lower is better)",
          },
        },
        y: {
          ticks: {
            // Limit label length for better fit
            callback: function (value, index) {
              const label = this.getLabelForValue(index);
              return label.length > 15 ? label.substring(0, 12) + "..." : label;
            },
          },
        },
      },
      plugins: {
        title: {
          display: true,
          text: "Latency Comparison",
        },
        legend: {
          display: false, // Hide legend for cleaner look
        },
      },
    },
  };

  // Generate requests comparison chart - sort by highest throughput and adjust sizing
  const sortedByThroughput = [...testResults].sort(
    (a, b) => b.result.requests.average - a.result.requests.average
  );

  const reqCompChart = {
    type: "bar",
    data: {
      labels: sortedByThroughput.map((test) => test.name),
      datasets: [
        {
          label: "Requests per Second",
          data: sortedByThroughput.map((test) => test.result.requests.average),
          backgroundColor: generateColorGradient(testResults.length).reverse(), // Reverse colors - higher is better
          borderColor: borderColors.slice().reverse(),
          borderWidth: 1,
        },
      ],
    },
    options: {
      indexAxis: "y", // Horizontal bar chart
      scales: {
        x: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Requests/Second (higher is better)",
          },
        },
        y: {
          ticks: {
            // Limit label length for better fit
            callback: function (value, index) {
              const label = this.getLabelForValue(index);
              return label.length > 15 ? label.substring(0, 12) + "..." : label;
            },
          },
        },
      },
      plugins: {
        title: {
          display: true,
          text: "Throughput Comparison",
        },
        legend: {
          display: false, // Hide legend for cleaner look
        },
      },
    },
  };

  // Create chart images
  const latencyCompBuffer = await chartJSNodeCanvas.renderToBuffer(
    latencyCompChart
  );
  const reqCompBuffer = await chartJSNodeCanvas.renderToBuffer(reqCompChart);

  // Generate PDF with more careful pagination
  const doc = new PDFDocument({
    margin: 50,
    size: "A4", // Standard A4 size for better predictability
    bufferPages: true, // Enable buffering to allow page manipulation
  });

  const reportPath = path.join(
    outputDir,
    `comparison-report-${Date.now()}.pdf`
  );
  const writeStream = fs.createWriteStream(reportPath);

  writeStream.on("finish", () => {
    console.log(`Comparison PDF saved: ${reportPath}`);
  });

  doc.pipe(writeStream);

  // Function to check and add page if needed
  const checkAndAddPage = (requiredHeight) => {
    const currentY = doc.y;
    const availableSpace = doc.page.height - doc.page.margins.bottom - currentY;

    if (availableSpace < requiredHeight) {
      doc.addPage();
      return true;
    }
    return false;
  };

  // Function to get shortened name
  const getShortenedName = (name, maxLength = 15) => {
    return name.length > maxLength
      ? name.substring(0, maxLength - 3) + "..."
      : name;
  };

  // Header
  doc.fontSize(24).text("Test Comparison Report", { align: "center" });
  doc.moveDown();
  doc
    .fontSize(14)
    .text(`Generated on ${new Date().toLocaleString()}`, { align: "center" });
  doc.moveDown();
  doc
    .fontSize(12)
    .text(`${testResults.length} scenarios compared`, { align: "center" });
  doc.moveDown(2);

  // Summary of best performers
  doc.fontSize(16).text("Performance Summary", { underline: true });
  doc.moveDown();
  doc.fontSize(12);
  doc.text(
    `Best Latency: ${getShortenedName(
      testResults[0].name,
      25
    )} (${testResults[0].result.latency.average.toFixed(2)} ms)`
  );
  doc.text(
    `Best Throughput: ${getShortenedName(
      sortedByThroughput[0].name,
      25
    )} (${sortedByThroughput[0].result.requests.average.toFixed(2)} req/sec)`
  );
  doc.moveDown(2);

  // Add latency comparison chart - check space first
  const chartHeight = 320; // Height of chart plus margins
  checkAndAddPage(chartHeight);

  doc.fontSize(16).text("Latency Comparison", { underline: true });
  doc.moveDown();
  doc.image(latencyCompBuffer, {
    fit: [450, 250], // Ensure it fits within margins
    align: "center",
  });
  doc.moveDown();

  // Add requests comparison chart - check space first
  checkAndAddPage(chartHeight);

  doc.fontSize(16).text("Throughput Comparison", { underline: true });
  doc.moveDown();
  doc.image(reqCompBuffer, {
    fit: [450, 250], // Ensure it fits within margins
    align: "center",
  });

  // Always start detailed comparison on a new page
  doc.addPage();

  // Create a comparison table
  doc.fontSize(16).text("Detailed Comparison", { underline: true });
  doc.moveDown();

  // Calculate table dimensions based on page size and number of tests
  const tableTop = doc.y + 10;
  const pageWidth =
    doc.page.width - (doc.page.margins.left + doc.page.margins.right);
  const metricColWidth = Math.min(150, pageWidth * 0.3); // 30% of page width, max 150px

  // Calculate data column width - distribute remaining space evenly
  const remainingWidth = pageWidth - metricColWidth;
  const maxTests = Math.min(
    testResults.length,
    Math.floor(remainingWidth / 70)
  ); // Min 70px per test column
  const dataColWidth = remainingWidth / maxTests;

  // We'll handle test results in batches if there are too many
  const batches = [];
  for (let i = 0; i < testResults.length; i += maxTests) {
    batches.push(testResults.slice(i, i + maxTests));
  }

  // Define metrics
  const metrics = [
    { name: "Min Latency (ms)", getter: (t) => t.result.latency.min },
    {
      name: "Avg Latency (ms)",
      getter: (t) => t.result.latency.average.toFixed(2),
    },
    { name: "Max Latency (ms)", getter: (t) => t.result.latency.max },
    { name: "P90 Latency (ms)", getter: (t) => t.result.latency.p90 || "-" },
    { name: "P99 Latency (ms)", getter: (t) => t.result.latency.p99 || "-" },
    { name: "Req/sec", getter: (t) => t.result.requests.average.toFixed(2) },
    { name: "Total Requests", getter: (t) => t.result.requests.total },
    { name: "Errors", getter: (t) => t.result.errors || 0 },
    {
      name: "Throughput (KB/s)",
      getter: (t) => (t.result.throughput.average / 1024).toFixed(2),
    },
  ];

  // Process each batch of test results
  let batchIndex = 0;
  for (const batch of batches) {
    if (batchIndex > 0) {
      // Start a new page for each batch after the first
      doc.addPage();
      doc
        .fontSize(16)
        .text(
          `Detailed Comparison (continued - ${batchIndex + 1}/${
            batches.length
          })`,
          { underline: true }
        );
      doc.moveDown();
    }

    let rowY = doc.y + 10;

    // Draw header for this batch
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Metric", doc.page.margins.left, rowY, { width: metricColWidth });

    batch.forEach((test, index) => {
      const testName = getShortenedName(test.name);
      doc.text(
        testName,
        doc.page.margins.left + metricColWidth + dataColWidth * index,
        rowY,
        { width: dataColWidth, align: "center" }
      );
    });

    // Draw header separator line
    rowY += 15;
    doc
      .moveTo(doc.page.margins.left, rowY)
      .lineTo(
        doc.page.margins.left + metricColWidth + dataColWidth * batch.length,
        rowY
      )
      .stroke();

    // Draw rows
    doc.font("Helvetica");
    rowY += 10;

    const rowHeight = 20;

    metrics.forEach((metric, idx) => {
      // Check if we need a new page
      if (rowY + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        rowY = doc.page.margins.top + 30;

        // Redraw header on new page
        doc.fontSize(10).font("Helvetica-Bold");
        doc.text("Metric", doc.page.margins.left, rowY, {
          width: metricColWidth,
        });

        batch.forEach((test, index) => {
          const testName = getShortenedName(test.name);
          doc.text(
            testName,
            doc.page.margins.left + metricColWidth + dataColWidth * index,
            rowY,
            { width: dataColWidth, align: "center" }
          );
        });

        // Draw header separator line
        rowY += 15;
        doc
          .moveTo(doc.page.margins.left, rowY)
          .lineTo(
            doc.page.margins.left +
              metricColWidth +
              dataColWidth * batch.length,
            rowY
          )
          .stroke();

        doc.font("Helvetica");
        rowY += 10;
      }

      // Alternate row colors for better readability
      if (idx % 2 === 0) {
        doc
          .rect(
            doc.page.margins.left,
            rowY - 5,
            metricColWidth + dataColWidth * batch.length,
            rowHeight
          )
          .fill("#f5f5f5");
        doc.fillColor("black");
      }

      // Draw metric name
      doc.fontSize(9);
      doc.text(metric.name, doc.page.margins.left, rowY, {
        width: metricColWidth,
      });

      // Draw values for each test
      batch.forEach((test, index) => {
        const value = String(metric.getter(test));
        doc.text(
          value,
          doc.page.margins.left + metricColWidth + dataColWidth * index,
          rowY,
          { width: dataColWidth, align: "center" }
        );
      });

      rowY += rowHeight;
    });

    batchIndex++;
  }

  doc.end();
}

// Express route to trigger tests
app.get("/run-test", async (req, res) => {
  try {
    runTests().then(() => {
      console.log("Tests completed via web request");
    });
    res.json({
      message:
        "Tests started. Check console for progress and reports directory for results.",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a route to view previous test results
app.get("/reports", (req, res) => {
  const outputDir = path.join(process.cwd(), "reports");
  try {
    if (!fs.existsSync(outputDir)) {
      return res.json({ message: "No reports found" });
    }

    const files = fs
      .readdirSync(outputDir)
      .filter((f) => f.endsWith(".pdf"))
      .map((f) => ({
        name: f,
        path: `/reports/${f}`,
        created: fs.statSync(path.join(outputDir, f)).ctime,
      }))
      .sort((a, b) => b.created - a.created);

    res.json({ reports: files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve report files
app.use("/reports", express.static(path.join(process.cwd(), "reports")));

// Initialize
if (require.main === module) {
  // Direct execution - run tests immediately
  console.log(`Loading configuration from: ${configPath}`);
  runTests().then(() => {
    console.log("Testing complete");
  });
} else {
  // Module import - start express server
  app.listen(port, () => {
    console.log(`Load test server listening on port ${port}`);
    console.log(`Visit http://localhost:${port}/run-test to start tests`);
    console.log(
      `Visit http://localhost:${port}/reports to view available reports`
    );
  });
}

module.exports = { runTest, generatePDF, runTests };
