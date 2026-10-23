import { createDiagram, addNode, addEdge } from '../src/drawio-xml.ts';

const path = process.argv[2];
if (!path) throw new Error('usage: node test/aws-demo.ts <path.drawio>');

function resourceIcon(color: string, service: string): string {
  return `sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;fontColor=#232F3E;fillColor=${color};strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.${service}`;
}

const CLIENT_STYLE =
  'sketch=0;outlineConnect=0;fontColor=#232F3E;fillColor=#232F3D;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;shape=mxgraph.aws4.client;';

const GROUP_STYLE =
  'shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_aws_cloud_alt;strokeColor=#232F3E;fillColor=none;verticalAlign=top;align=left;fontColor=#232F3E;dashed=0;container=1;dropTarget=1;collapsible=0;recursiveResize=0;html=1;fontSize=12;';

// jumpStyle=arc draws a small hop wherever this edge crosses another edge, instead of a
// flat intersection — a per-edge style, evaluated at render time from actual geometry, so
// it costs nothing to leave on by default even on diagrams with no crossings yet.
const CROSSINGS = 'jumpStyle=arc;jumpSize=6;';

const EDGE_RIGHT = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=2;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;${CROSSINGS}`;

// Any node using verticalLabelPosition=bottom renders its label just below the shape.
// An edge that EXITS the bottom (exitY=1) starts at the shape's bottom edge and runs
// straight through that label text unless pushed past it first. entryY=0 (entering a
// TOP) never has this problem — there's no label above a shape. Keep this offset on
// every bottom-exit edge instead of re-deriving it per diagram.
const LABEL_CLEARANCE = 26;

const EDGE_DOWN = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=2;exitX=0.5;exitY=1;exitDx=0;exitDy=${LABEL_CLEARANCE};entryX=0.5;entryY=0;entryDx=0;entryDy=0;${CROSSINGS}`;

const PAGE_WIDTH = 1300;
const PAGE_HEIGHT = 760;

createDiagram(path, { pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT, dx: 1500, dy: 900 });

// PNG export background (lowest z-order)
addNode(path, {
  id: 'bg',
  x: 0,
  y: 0,
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
  style: 'rounded=0;whiteSpace=wrap;html=1;fillColor=#F5F5F5;strokeColor=none;',
});

// Title block
addNode(path, {
  id: 'title',
  label: '<b>Typical Serverless Web App</b><br>drawio-agentic stress test | 2026-10-22 | v1',
  x: 40,
  y: 30,
  width: 420,
  height: 60,
  style: 'text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;rounded=0;fontSize=14;spacing=8;',
});

// AWS Cloud boundary (container)
const CX = 220;
const CY = 160;
const CW = 900;
const CH = 500;
addNode(path, { id: 'aws-cloud', label: 'AWS Cloud', x: CX, y: CY, width: CW, height: CH, style: GROUP_STYLE });

// Client (outside the boundary)
addNode(path, { id: 'client', label: 'Client', x: 40, y: 340, width: 78, height: 78, style: CLIENT_STYLE });

// Services inside the boundary (coordinates relative to the container)
addNode(path, { id: 'svc-cloudfront', label: 'CloudFront', x: 60, y: 180, width: 78, height: 78, style: resourceIcon('#8C4FFF', 'cloudfront'), parent: 'aws-cloud' });
addNode(path, { id: 'svc-apigw', label: 'API Gateway', x: 280, y: 180, width: 78, height: 78, style: resourceIcon('#E7157B', 'api_gateway'), parent: 'aws-cloud' });
addNode(path, { id: 'svc-lambda', label: 'Lambda', x: 500, y: 180, width: 78, height: 78, style: resourceIcon('#ED7100', 'lambda'), parent: 'aws-cloud' });
addNode(path, { id: 'svc-dynamodb', label: 'DynamoDB', x: 720, y: 180, width: 78, height: 78, style: resourceIcon('#C925D1', 'dynamodb'), parent: 'aws-cloud' });
addNode(path, { id: 'svc-s3', label: 'S3', x: 500, y: 380, width: 78, height: 78, style: resourceIcon('#7AA116', 's3'), parent: 'aws-cloud' });
// Same resourceIcon square as the other five, not the taller two-tone productIcon shape —
// mixing shape families in one diagram is what read as an "empty white box" next to it.
addNode(path, { id: 'svc-sqs', label: 'SQS', x: 504, y: 10, width: 78, height: 78, style: resourceIcon('#E7157B', 'sqs'), parent: 'aws-cloud' });

// Edges (all parented at the root layer, including the one cross-container edge)
addEdge(path, { source: 'client', target: 'svc-cloudfront', label: 'HTTPS', style: EDGE_RIGHT + 'labelBackgroundColor=#F5F5F5;fontSize=11;' });
addEdge(path, { source: 'svc-cloudfront', target: 'svc-apigw', style: EDGE_RIGHT });
addEdge(path, { source: 'svc-apigw', target: 'svc-lambda', style: EDGE_RIGHT });
addEdge(path, { source: 'svc-lambda', target: 'svc-dynamodb', style: EDGE_RIGHT });
addEdge(path, { source: 'svc-lambda', target: 'svc-s3', style: EDGE_DOWN });
addEdge(path, { source: 'svc-sqs', target: 'svc-lambda', style: EDGE_DOWN });

console.log('Built AWS demo diagram at', path);
