// This plugin will open a modal to prompt the user to enter a number, and
// it will then create that many rectangles on the screen.
// This file holds the main code for the plugins. It has access to the *document*.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (see documentation).
// This shows the HTML page in "ui.html".
figma.showUI(__html__, { width: 245, height: 278 });
// Calls to "parent.postMessage" from within the HTML page will trigger this
// callback. The callback will be passed the "pluginMessage" property of the
// posted message.
figma.ui.onmessage = msg => {
    var _a;
    (_a = commands[msg.type]) === null || _a === void 0 ? void 0 : _a.call(commands, msg);
};
let projectedNodes = [];
let projectionNodes = [];
let commands = {
    project({ angle, dist, invert, stroke, strokeColor, strokeAlpha, fill, fillColor, fillAlpha, group }) {
        //console.log(angle, dist, figma.currentPage.selection);
        projectionNodes = figma.currentPage.selection.map(n => n.id);
        let nodes = figma.currentPage.selection;
        runProjection(nodes, angle, dist, invert, stroke, strokeColor, strokeAlpha, fill, fillColor, fillAlpha, group);
        if (nodes.length > 0) {
            figma.ui.postMessage('enableUpdate');
        }
    },
    update({ angle, dist, invert, stroke, strokeColor, strokeAlpha, fill, fillColor, fillAlpha, group }) {
        //check if user intervened since last update
        if (projectedNodes.some(n => n.removed)) {
            //send signal to ui
            figma.ui.postMessage('disableUpdate');
            return;
        }
        projectedNodes.forEach(n => n.remove());
        let nodes = projectionNodes.map(figma.getNodeById);
        runProjection(nodes, angle, dist, invert, stroke, strokeColor, strokeAlpha, fill, fillColor, fillAlpha, group);
    },
    cancel() {
        //check if user intervened since last update
        if (projectedNodes.some(n => n.removed)) {
            //send signal to ui
            figma.ui.postMessage('disableUpdate');
            return;
        }
        projectedNodes.forEach(n => n.remove());
        figma.closePlugin();
    }
    /* close(){
      figma.closePlugin();
    } */
};
function runProjection(nodes, angle, dist, invert, stroke, strokeColor, strokeAlpha, fill, fillColor, fillAlpha, group) {
    if (nodes.length == 0) {
        return;
    }
    const selection = [];
    //convert to radians
    angle = (angle / 180) * Math.PI;
    let strokePaint = {
        blendMode: "NORMAL",
        color: strokeColor ? hexToRGB(strokeColor) : { r: 0, g: 0, b: 0 },
        opacity: strokeAlpha,
        type: "SOLID",
        visible: true
    };
    let fillPaint = {
        blendMode: "NORMAL",
        color: fillColor ? hexToRGB(fillColor) : { r: 0, g: 0, b: 0 },
        opacity: fillAlpha,
        type: "SOLID",
        visible: true
    };
    nodes.forEach(node => {
        let strokes = stroke && ((strokeColor && [strokePaint]) || node.strokes);
        let fills = fill && ((fillColor && [fillPaint]) || node.fills);
        console.log(strokes, fills);
        selection.push(...projectNode(node, angle, dist, invert, strokes, fills));
    });
    if (group) {
        figma.group(selection, selection[0].parent, selection[0].parent.children.indexOf(selection[0]) + 1);
    }
    projectedNodes = selection;
    figma.currentPage.selection = selection;
}
function clone(val) {
    const type = typeof val;
    if (val === null) {
        return null;
    }
    else if (type === 'undefined' || type === 'number' ||
        type === 'string' || type === 'boolean') {
        return val;
    }
    else if (type === 'object') {
        if (val instanceof Array) {
            return val.map(x => clone(x));
        }
        else if (val instanceof Uint8Array) {
            return new Uint8Array(val);
        }
        else {
            let o = {};
            for (const key in val) {
                o[key] = clone(val[key]);
            }
            return o;
        }
    }
    throw 'unknown';
}
function projectNode(node, angle, dist, invert, strokes, fills) {
    console.log({ angle }, { dist }, { invert }, { strokes }, { fills });
    let parent = node.parent;
    //convert <N>node to VectorNode (in-place)
    let clonedNode = node.clone();
    parent.insertChild(parent.children.indexOf(node), clonedNode);
    let vector = figma.flatten([clonedNode]);
    let nodeIndex = vector.parent.children.indexOf(vector) + 1;
    addTangentPoints(vector, angle);
    //clone VectorNetwork properties
    let network = clone(vector.vectorNetwork);
    console.log(network);
    //sort segments by distance along projection angle;
    let center = getNetworkCenter(network);
    let segments = network.segments;
    let angleVector = { x: Math.cos(angle), y: Math.sin(angle) };
    segments.forEach((seg, i) => {
        //TODO: calculate dist using furthest location on bezier path
        //TODO:  (requires finding tangents of perpendicular angle. slow)
        let midpoint = {
            x: (network.vertices[seg.start].x + network.vertices[seg.end].x) / 2,
            y: (network.vertices[seg.start].y + network.vertices[seg.end].y) / 2
        };
        seg.dist = midpoint.x * angleVector.x + midpoint.y * angleVector.y;
    });
    segments.sort((a, b) => a.dist - b.dist);
    let shapes = [];
    //extrude each segment into a closed shape
    for (let i = 0; i < segments.length; i++) {
        //reverse order unless distance is negative
        let j = dist < 0 ? i : segments.length - 1 - i;
        //reverse order if inverted
        if (invert) {
            j = segments.length - 1 - j;
        }
        //console.log(j);
        let seg = segments[j];
        let shape = figma.createVector();
        let baseVerts = [network.vertices[seg.start], network.vertices[seg.end]];
        //clone nodes (in reverse, to ensure correct shape enclosure)
        let extrudedVerts = [clone(network.vertices[seg.end]), clone(network.vertices[seg.start])];
        //position extruded verts
        extrudedVerts.forEach(v => {
            v.x += dist * Math.cos(angle);
            v.y += dist * Math.sin(angle);
        });
        //create shape with missing segments
        // also copy base segment handles to cloned segments
        shape.vectorNetwork = {
            vertices: [...baseVerts, ...extrudedVerts],
            segments: [
                { start: 0, end: 1, tangentStart: seg.tangentStart, tangentEnd: seg.tangentEnd },
                { start: 1, end: 2 },
                { start: 2, end: 3, tangentStart: seg.tangentEnd, tangentEnd: seg.tangentStart },
                { start: 3, end: 0 },
            ]
        };
        shape.name = seg.start + ' ' + seg.end;
        //copy base fills and strokes to shape
        shape.fills = fills || [];
        shape.strokes = strokes || [];
        shape.strokeWeight = vector.strokeWeight;
        shape.strokeAlign = vector.strokeAlign;
        shape.strokeCap = vector.strokeCap;
        shape.strokeJoin = 'ROUND'; //always use round(?)
        shape.dashPattern = vector.dashPattern;
        //position shape relative to parent
        let transform = clone(shape.relativeTransform);
        transform.forEach((t, i) => t[2] += vector.relativeTransform[i][2]);
        shape.relativeTransform = transform;
        //place shape in document, as sibling of selection
        if (invert) {
            vector.parent.insertChild(nodeIndex + 1, shape);
        }
        else {
            vector.parent.insertChild(nodeIndex, shape);
        }
        shapes.push(shape);
    }
    //remove backface if inverted(?)
    if (invert) {
        vector.remove();
    }
    else {
        //send cloned shape to end of projection
        let transform = clone(vector.relativeTransform);
        transform[0][2] += dist * Math.cos(angle);
        transform[1][2] += dist * Math.sin(angle);
        vector.relativeTransform = transform;
        vector.fills = fills || [];
        vector.strokes = strokes || [];
        shapes.push(vector);
    }
    return shapes;
}
function addTangentPoints(vector, angle) {
    let network = clone(vector.vectorNetwork);
    console.log(network);
    //iterate segments
    let w = 0;
    network.segments.forEach((_seg, s) => {
        w = s; //working segment index
        let seg = network.segments[w];
        //bezier curve points
        let _p1 = network.vertices[seg.start];
        let p1 = { x: _p1.x, y: _p1.y };
        let _p4 = network.vertices[seg.end];
        let p4 = { x: _p4.x, y: _p4.y };
        let _p2 = seg.tangentStart;
        //offset handles by parent vertex
        let p2 = { x: p1.x + _p2.x, y: p1.y + _p2.y };
        let _p3 = seg.tangentEnd;
        let p3 = { x: p4.x + _p3.x, y: p4.y + _p3.y };
        //get tangent t values
        let tangents = findBezierTangents(p1, p2, p3, p4, angle);
        //sort tangents
        tangents.sort((a, b) => a - b);
        //bisect segments with new tangent points
        let u = 0; //accumulative t value
        tangents.forEach((t, i) => {
            let p = bezier(p1, p2, p3, p4, t);
            //rebase t from previous bezier bisection
            t = (t - u) / (1 - u);
            //add to t accumulator
            u += t * (1 - u);
            let newVertex = clone(network.vertices[0]);
            newVertex.x = p.x;
            newVertex.y = p.y;
            //add new vertex
            let newVertexIndex = network.vertices.push(newVertex) - 1;
            let seg = network.segments[w];
            //calculate new nodes, due to previous bezier bisection
            let p1new = { x: network.vertices[seg.start].x, y: network.vertices[seg.start].y };
            let p4new = { x: network.vertices[seg.end].x, y: network.vertices[seg.end].y };
            let p2new = { x: p1new.x + seg.tangentStart.x, y: p1new.y + seg.tangentStart.y };
            let p3new = { x: p4new.x + seg.tangentEnd.x, y: p4new.y + seg.tangentEnd.y };
            //from https://stackoverflow.com/questions/2613788/algorithm-for-inserting-points-in-a-piecewise-cubic-b%C3%A9zier-path
            let q1 = { x: (1 - t) * p1new.x + t * p2new.x, y: (1 - t) * p1new.y + t * p2new.y };
            let q2 = { x: (1 - t) * p2new.x + t * p3new.x, y: (1 - t) * p2new.y + t * p3new.y };
            let q3 = { x: (1 - t) * p3new.x + t * p4new.x, y: (1 - t) * p3new.y + t * p4new.y };
            let q12 = { x: (1 - t) * q1.x + t * q2.x, y: (1 - t) * q1.y + t * q2.y };
            let q23 = { x: (1 - t) * q2.x + t * q3.x, y: (1 - t) * q2.y + t * q3.y };
            //calculated handle points
            let h1 = { x: q1.x - p1new.x, y: q1.y - p1new.y };
            let h2 = { x: q12.x - newVertex.x, y: q12.y - newVertex.y };
            let h3 = { x: q23.x - newVertex.x, y: q23.y - newVertex.y };
            let h4 = { x: q3.x - p4new.x, y: q3.y - p4new.y };
            //console.log('...', network);
            //debugger;
            let loop;
            let loopIndex;
            let foundLoop = false;
            let flipVerts = false;
            network.regions.forEach(r => {
                r.loops.forEach(l => {
                    if (l.length > 1) {
                        let li = l.indexOf(w);
                        if (li >= 0) {
                            loop = l;
                            loopIndex = li;
                            let seg1 = network.segments[loop[loopIndex]];
                            let seg2 = network.segments[loop[mod(loopIndex - 1, loop.length)]];
                            //check if segment vertices are flipped, relative to previous segment
                            if (seg1.end == seg2.start || seg1.end == seg2.end) {
                                flipVerts = true;
                            }
                            foundLoop = true;
                            return;
                        }
                    }
                });
                if (foundLoop) {
                    return;
                }
            });
            let newSegmentIndex;
            let start1 = seg.start;
            let end1 = seg.end;
            let start2 = seg.start;
            let end2 = seg.end;
            let tangentStart1 = h1;
            let tangentEnd1 = h2;
            let tangentStart2 = h3;
            let tangentEnd2 = h4;
            if (flipVerts) {
                start1 = newVertexIndex;
                end2 = newVertexIndex;
                //flip the handles too
                tangentStart1 = h3;
                tangentEnd1 = h4;
                tangentStart2 = h1;
                tangentEnd2 = h2;
            }
            else {
                end1 = newVertexIndex;
                start2 = newVertexIndex;
            }
            //replace base segment with first bisection
            network.segments.splice(w, 1, {
                start: start1,
                end: end1,
                tangentStart: tangentStart1,
                tangentEnd: tangentEnd1
            });
            //append second bisection to segments (to prevent insertions)
            newSegmentIndex = network.segments.push({
                start: start2,
                end: end2,
                tangentStart: tangentStart2,
                tangentEnd: tangentEnd2
            }) - 1;
            //console.log('!!!', network);
            if (foundLoop) {
                //add bisected segments to loop
                // the first segment's index matches the original segment's index
                // so only the second index needs to be inserted
                loop.splice(mod(loopIndex + 1, loop.length), 0, newSegmentIndex);
            }
            //set working segment to newly inserted segment, 
            // in case of second tangent (which will always be in the second bisection)
            w = newSegmentIndex;
        });
    });
    //console.log({network});
    //update vectorNetwork
    vector.vectorNetwork = network;
}
function findBezierTangents(p1, p2, p3, p4, target) {
    let epsilon = 1e-1; //threshold
    let solutions = [
        findBezierTangent(p1, p2, p3, p4, target, 0 + 1e-4, true),
        findBezierTangent(p1, p2, p3, p4, target, 0 + 1e-4, false),
        findBezierTangent(p1, p2, p3, p4, target, 1 - 1e-4, true),
        findBezierTangent(p1, p2, p3, p4, target, 1 - 1e-4, false),
        findBezierTangent(p1, p2, p3, p4, target, 0.5, true),
        findBezierTangent(p1, p2, p3, p4, target, 0.5, false),
    ];
    //console.log({solutions});
    let filtered = solutions.filter((v, i) => {
        //trim out-of-bounds results
        if (v <= 0 + epsilon || v >= 1 - epsilon) {
            return false;
        }
        //trim duplicates
        let removeIndex = solutions.findIndex((w, j) => {
            return j < i && Math.abs(mod(((v - w) + Math.PI / 2), Math.PI) - Math.PI / 2) < epsilon;
        });
        if (removeIndex >= 0) {
            return false;
        }
        //trim false-positives
        let p = bezierDeriv(p1, p2, p3, p4, v);
        if (Math.abs(mod(((Math.atan2(p.y, p.x) - target) + Math.PI / 2), Math.PI) - Math.PI / 2) > 0.1) {
            return false;
        }
        return true;
    });
    //console.log({filtered});
    return filtered;
}
function findBezierTangent(p1, p2, p3, p4, target, guess, flip) {
    let epsilon = 1e-4; //threshold
    let t = []; //guesses
    t[0] = guess; //initial guess
    let i = 0;
    let diff = 10000;
    while (Math.abs(diff) > epsilon && i < 100) {
        let v = bezierDeriv(p1, p2, p3, p4, t[i]);
        //get difference between current tangent and target tangent (scaled to [-0.5 - 0.5] instead of [-pi - pi])
        let baseDiff = 0;
        if (flip) {
            baseDiff = target - Math.atan2(v.y, v.x);
        }
        else {
            baseDiff = Math.atan2(v.y, v.x) - target;
        }
        diff = (mod((baseDiff) / Math.PI + 0.5, 1) - 0.5);
        //scaling factor to mitigate quasi-stable state around solution
        let errScale = 1;
        if (i > 4) {
            if (Math.abs((t[t.length - 1] - t[t.length - 2]) - (t[t.length - 3] - t[t.length - 4])) < 1e-2 && Math.abs(diff) > 1e-2) {
                errScale = 0.5;
            }
        }
        //set test half-way towards diff and current test
        t.push(t[i] + errScale * 0.5 * diff);
        //quit early if already out-of-bounds
        if (t[t.length - 1] < 0 || t[t.length - 1] > 1) {
            return -1;
        }
        i++;
    }
    //console.log(t);
    if (Math.abs((t[t.length - 1] - t[t.length - 2]) - (t[t.length - 3] - t[t.length - 4])) > 1e-2) {
        return -1;
    }
    else {
        return t[t.length - 1];
    }
}
function bezier(p1, p2, p3, p4, t) {
    return {
        x: (Math.pow((1 - t), 3)) * p1.x + ((3 * t) * (Math.pow((1 - t), 2))) * p2.x + ((3 * (Math.pow(t, 2))) * (1 - t) * p3.x) + (Math.pow(t, 3)) * p4.x,
        y: (Math.pow((1 - t), 3)) * p1.y + ((3 * t) * (Math.pow((1 - t), 2))) * p2.y + ((3 * (Math.pow(t, 2))) * (1 - t) * p3.y) + (Math.pow(t, 3)) * p4.y
    };
}
function bezierDeriv(p1, p2, p3, p4, t) {
    return {
        x: 3 * (Math.pow((1 - t), 2)) * (p2.x - p1.x) + 6 * ((1 - t) * t) * (p3.x - p2.x) + 3 * (Math.pow(t, 2)) * (p4.x - p3.x),
        y: 3 * (Math.pow((1 - t), 2)) * (p2.y - p1.y) + 6 * ((1 - t) * t) * (p3.y - p2.y) + 3 * (Math.pow(t, 2)) * (p4.y - p3.y)
    };
}
function getNetworkCenter(network) {
    let acc;
    let count = network.vertices.length;
    network.vertices.forEach(v => {
        if (!acc) {
            acc = { x: v.x, y: v.y };
        }
        else {
            acc.x += v.x;
            acc.y += v.y;
        }
    });
    let avg = { x: acc.x / count, y: acc.y / count };
    return avg;
}
function mod(x, n) {
    return (((x % n) + n) % n);
}
function hexToRGB(hex) {
    var c;
    if (/^#?([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
        c = hex.replace('#', '').split('');
        if (c.length == 3) {
            c = [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        c = '0x' + c.join('');
        return { r: ((c >> 16) & 255) / 255, g: ((c >> 8) & 255) / 255, b: (c & 255) / 255 };
    }
    return { r: 0, g: 0, b: 0 };
    //throw new Error('Bad Hex');
}
