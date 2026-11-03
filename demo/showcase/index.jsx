import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Showcase } from './showcase.jsx';
import { FPS, DURATION } from './timeline.mjs';

registerRoot(() => <Composition id="LoNoShowcase" component={Showcase} width={1920} height={1080} fps={FPS} durationInFrames={DURATION * FPS}/>);
