export type CadTool = 
  | 'select'
  | 'guideline'       // Road border / helper line
  | 'yellow_double'   // Double yellow lines
  | 'white_double'    // Double white lines
  | 'white_dashed'    // White dashed lane lines
  | 'yellow_dashed'   // Yellow dashed lane lines
  | 'white_solid'     // White solid lane lines
  | 'sketch_circle'   // Circle helper draft lines
  | 'channelization'  // Close polygon for channelization island
  | 'text_label'      // Text label annotation
  | 'smart_path'      // Illustrator-style pen tool with cubic bezier and curves limit check
  | 'crosswalk'       // Asymmetric dynamic crosswalk generator
  | 'BuildingLine'    // Building Line / Sidewalk limit
  | 'map_scale'       // Map scaling calibration tool
  | 'crossing_dashed' // Supplemental dashed line
  | 'stop_line'       // Stop line white solid
  | 'yield_line'      // Yield standard parallel triangles
  | 'Sidewalk'        // Gray sidewalk pavement
  | 'parking_space'   // Custom parking spaces
  | 'bicycle_lane'    // Custom pink bicycle lanes
  | 'reversible_lane' // Double white dashed lines with 10cm gap
  | 'parking_zone'    // Multi-slot parking generator along a path
  | 'road_arrow'      // Road markings direction arrows
  | 'measurement'     // Distance measuring tool
  | 'angular_dimension' // Angle dimensioning tool
  | 'arc_3point'       // 3-point arc drawing tool
  | 'red_solid'        // 禁止臨時停車線（紅實線）
  | 'yellow_solid'     // 禁止停車線（黃實線）
  | 'grid_box'         // 網狀線（黃色交叉斜紋）
  | 'moto_box'         // 機車停等區
  | 'moto_turn_box'    // 機車待轉區
  | 'road_text';       // 路面標字

export interface Point2D {
  x: number; // in meters (World coordinate)
  y: number; // in meters (World coordinate)
}

export interface ViewportState {
  zoom: number;      // pixels per meter
  panX: number;      // pixel offset
  panY: number;      // pixel offset
}

export interface BaseElement {
  id: string;
  type: 'guideline' | 'yellow_double' | 'white_double' | 'white_dashed' | 'yellow_dashed' | 'white_solid' | 'three_center_curve' | 'island' | 'text' | 'smart_path' | 'sketch_circle' | 'crosswalk' | 'BuildingLine' | 'crossing_dashed' | 'stop_line' | 'yield_line' | 'Sidewalk' | 'parking_space' | 'bicycle_lane' | 'reversible_lane' | 'parking_zone' | 'road_arrow' | 'measurement' | 'angular_dimension' | 'red_solid' | 'yellow_solid' | 'moto_box' | 'moto_turn_box' | 'road_text';
  color?: string;
  lineWidth?: number; // in meters or pixels
}

export interface LineElement extends BaseElement {
  type: 'guideline' | 'yellow_double' | 'white_double' | 'white_dashed' | 'yellow_dashed' | 'white_solid' | 'crossing_dashed' | 'stop_line' | 'yield_line' | 'Sidewalk' | 'reversible_lane' | 'red_solid' | 'yellow_solid';
  p1?: Point2D;
  p2?: Point2D;
  points?: Point2D[];
  cpLeft?: Point2D[];
  cpRight?: Point2D[];
  minRadius?: number;
  isValid?: boolean;
  isLeftTurnGuide?: boolean;
  sgn?: number;
}

export interface ThreeCenterCurveElement extends BaseElement {
  type: 'three_center_curve';
  // Input parameters
  pStart: Point2D; // Input point on tangent 1
  pIntersection: Point2D; // Vertex input
  pEnd: Point2D; // Input point on tangent 2
  R2: number; // Middle radius
  R1: number; // Transition radius 1 (usually 3 * R2)
  R3: number; // Transition radius 3 (usually 3 * R2)
  
  // Output coordinates
  O1: Point2D; // Center of Arc 1
  O2: Point2D; // Center of Arc 2
  O3: Point2D; // Center of Arc 3
  T1: Point2D; // Tangent start point on line 1
  C12: Point2D; // Contact point Arc 1 & Arc 2
  C23: Point2D; // Contact point Arc 2 & Arc 3
  T2: Point2D; // Tangent end point on line 2
  
  // Points along the curves for drawing/DXF
  points: Point2D[];
}

export interface IslandElement extends BaseElement {
  type: 'island';
  outerCurveId?: string; // Associated three center curve
  points: Point2D[]; // Polygon vertices
  cpLeft?: Point2D[];
  cpRight?: Point2D[];
  hasHatching: boolean; // Is filled with 45-degree striping?
  laneWidth: number; // The offset width used for generation
  designVehicle: 'passenger' | 'semi_trailer' | 'articulated';
  /** 'single' = 槽化線斜紋；'cross' = 網狀線交叉斜紋 */
  hatchPattern?: 'single' | 'cross';
  /** 斜紋間距（m） */
  hatchSpacing?: number;
  /** 斜紋角度（度） */
  hatchAngle?: number;
}

export interface MotoBoxElement extends BaseElement {
  type: 'moto_box' | 'moto_turn_box';
  /** 前緣（靠停止線）兩端點 */
  p1: Point2D;
  p2: Point2D;
  /** 深度（m），往 p1→p2 左側延伸 */
  depth: number;
  label?: string;
  fill?: boolean;
}

export interface RoadTextElement extends BaseElement {
  type: 'road_text';
  /** 插入點：最後一個字（最靠近駕駛人）的中心；字樣往行車方向延伸，第一個字在最遠處 */
  p: Point2D;
  text: string;
  /** 字高（m） */
  charHeight: number;
  /** 行車方向（rad，逆時針，0 = 朝東） */
  angle: number;
  widthFactor?: number;
  charGap?: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  p: Point2D;
  text: string;
  fontSize: number; // in meters
  angle?: number;   // rad
}

export interface SmartPathElement extends BaseElement {
  type: 'smart_path';
  points: Point2D[];      // Anchor coordinates
  cpLeft: Point2D[];      // Symmetric left control handles
  cpRight: Point2D[];     // Symmetric right control handles
  isValid: boolean;       // Curvature limit check passes
  minRadius: number;      // Smallest radius of curvature computed along segments
}

export interface SketchCircleElement extends BaseElement {
  type: 'sketch_circle';
  center: Point2D;
  radius: number;
}

export interface CrosswalkElement extends BaseElement {
  type: 'crosswalk';
  pA1: Point2D;
  pA2: Point2D;
  pB1: Point2D;
  pB2: Point2D;
  stripeWidth?: number; // default 0.4
  stripeGap?: number; // default 0.4
}

export interface BuildingLineElement extends BaseElement {
  type: 'BuildingLine';
  points: Point2D[];
}

export interface ParkingSpaceElement extends BaseElement {
  type: 'parking_space';
  p1: Point2D;
  p2: Point2D;
  slotType: 'car' | 'motorcycle';
  width: number;
  length: number;
  angle?: number;
  showSizeLabel?: boolean;
}

export interface BicycleLaneElement extends BaseElement {
  type: 'bicycle_lane';
  points: Point2D[];
  cpLeft: Point2D[];
  cpRight: Point2D[];
  width: number;
}

export interface ParkingZoneElement extends BaseElement {
  type: 'parking_zone';
  points: Point2D[];
  cpLeft: Point2D[];
  cpRight: Point2D[];
  slotType: 'car' | 'motorcycle';
  width: number;
  length: number;
  angle: number; // Angle relative to tangent in degrees (e.g. 90, 45, 0)
  gap: number;   // Gap between slots in meters
  side: 'left' | 'right';
  showSizeLabel?: boolean;
}

export interface RoadArrowElement extends BaseElement {
  type: 'road_arrow';
  p: Point2D;
  arrowType: 'straight' | 'left' | 'right' | 'straight_left' | 'straight_right';
  length: number;
  angle: number; // in radians
}

export interface MeasurementElement extends BaseElement {
  type: 'measurement';
  points: Point2D[]; // Contains p1 and p2
  cpLeft?: Point2D[];
  cpRight?: Point2D[];
}

export interface AngularDimensionElement extends BaseElement {
  type: 'angular_dimension';
  center: Point2D;
  pStart1: Point2D;
  pStart2: Point2D;
  angleDeg: number;
  points?: Point2D[]; // To keep array structure compatible with BaseElement
  cpLeft?: Point2D[];
  cpRight?: Point2D[];
}

export type CadElement = 
  | LineElement 
  | ThreeCenterCurveElement 
  | IslandElement 
  | TextElement 
  | SmartPathElement 
  | SketchCircleElement 
  | CrosswalkElement
  | BuildingLineElement
  | ParkingSpaceElement
  | BicycleLaneElement
  | ParkingZoneElement
  | RoadArrowElement
  | MeasurementElement
  | AngularDimensionElement
  | MotoBoxElement
  | RoadTextElement;

export interface SnapTarget {
  point: Point2D;
  type: 'endpoint' | 'midpoint' | 'intersection' | 'grid' | 'nearest';
  elementId?: string;
}

export interface IntersectionInfo {
  point: Point2D;
  elementId1: string;
  elementId2: string;
}

export interface Point {
  x: number;
  y: number;
}
