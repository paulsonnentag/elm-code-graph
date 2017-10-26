module Main exposing (..)

import Html exposing (..)
import Http
import Util exposing ((=>))
import Csv
import Array exposing (Array)
import Graph exposing (Edge, Graph, Node, NodeContext, NodeId)
import Html exposing (div)
import Html.Events exposing (on)
import Svg exposing (svg, line, g, circle)
import Json.Decode as Decode
import Svg.Attributes exposing (r, fill, strokeWidth, stroke, x1, x2, y1, y2, cx, cy, width, height, class)
import Mouse exposing (Position)
import Time exposing (Time)
import Visualization.Force as Force exposing (State)
import List.Extra
import AnimationFrame


-- APP


screenWidth : Float
screenWidth =
    1000


screenHeight : Float
screenHeight =
    800


main : Program Never Model Msg
main =
    Html.program
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        }



-- MODEL


type Model
    = Loading
    | Error String
    | Loaded Explorer


type alias Explorer =
    { drag : Maybe Drag
    , graph : Graph Entity ()
    , simulation : Force.State NodeId
    }


type alias Entity =
    Force.Entity NodeId { value : String }


type alias Drag =
    { start : Position
    , current : Position
    , index : NodeId
    }


init : ( Model, Cmd Msg )
init =
    let
        request =
            Http.getString "static/dependency-graph.csv"
    in
        ( Loading, Http.send LoadCsv request )



-- UPDATE


type Msg
    = LoadCsv (Result Http.Error String)
    | DragStart NodeId Position
    | DragAt Position
    | DragEnd Position
    | Tick Time


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case ( model, msg ) of
        ( _, LoadCsv result ) ->
            let
                newModel =
                    case result of
                        Ok data ->
                            Loaded (initExplorer (graphFromCsv (Csv.parse data)))

                        Err message ->
                            Error (toString message)
            in
                newModel => Cmd.none

        ( Loaded explorer, msg ) ->
            let
                { graph, simulation, drag } =
                    explorer

                newExplorer =
                    case msg of
                        Tick t ->
                            let
                                ( newState, list ) =
                                    Force.tick simulation <| List.map .label <| Graph.nodes graph
                            in
                                case drag of
                                    Nothing ->
                                        { explorer
                                            | graph = (updateGraphWithList explorer.graph list)
                                            , simulation = newState
                                        }

                                    Just { current, index } ->
                                        { explorer
                                            | graph = (Graph.update index (Maybe.map (updateNode current)) (updateGraphWithList graph list))
                                            , simulation = newState
                                        }

                        DragStart index xy ->
                            { explorer | drag = (Just (Drag xy xy index)) }

                        DragAt xy ->
                            case drag of
                                Just { start, index } ->
                                    { explorer
                                        | drag = (Just (Drag start xy index))
                                        , graph = (Graph.update index (Maybe.map (updateNode xy)) graph)
                                        , simulation = (Force.reheat simulation)
                                    }

                                Nothing ->
                                    { explorer | drag = Nothing }

                        DragEnd xy ->
                            case drag of
                                Just { start, index } ->
                                    { explorer
                                        | drag = Nothing
                                        , graph = (Graph.update index (Maybe.map (updateNode xy)) graph)
                                    }

                                Nothing ->
                                    { explorer | drag = Nothing }

                        _ ->
                            explorer
            in
                (Loaded newExplorer) => Cmd.none

        _ ->
            model => Cmd.none


subscriptions : Model -> Sub Msg
subscriptions model =
    Sub.batch [ Mouse.moves DragAt, Mouse.ups DragEnd, AnimationFrame.times Tick ]


initExplorer : Graph String () -> Explorer
initExplorer graph =
    let
        newGraph =
            Graph.mapContexts
                (\({ node } as ctx) ->
                    { ctx | node = { label = Force.entity node.id node.label, id = node.id } }
                )
                graph

        link { from, to } =
            ( from, to )

        forces =
            [ Force.links <| List.map link <| Graph.edges graph
            , Force.manyBody <| List.map .id <| Graph.nodes graph
            , Force.center (screenWidth / 2) (screenHeight / 2)
            ]
    in
        { drag = Nothing
        , graph = newGraph
        , simulation = (Force.simulation forces)
        }


graphFromCsv : Csv.Csv -> Graph String ()
graphFromCsv csv =
    let
        nodes =
            csv.records
                |> List.filterMap List.head
                |> List.Extra.unique

        edges =
            csv.records
                |> List.map Array.fromList
                |> List.filterMap (recordToEdge nodes)
    in
        Graph.fromNodeLabelsAndEdgePairs nodes edges


recordToEdge : List String -> Array String -> Maybe ( Int, Int )
recordToEdge nodes record =
    Maybe.map2 (,) (Array.get 0 record) (Array.get 1 record)
        |> Maybe.andThen (\( package, dependency ) -> Maybe.map2 (,) (List.Extra.elemIndex package nodes) (List.Extra.elemIndex dependency nodes))


updateNode : Position -> NodeContext Entity () -> NodeContext Entity ()
updateNode pos nodeCtx =
    let
        nodeValue =
            nodeCtx.node.label
    in
        updateContextWithValue nodeCtx { nodeValue | x = toFloat pos.x, y = toFloat pos.y }


updateContextWithValue : NodeContext Entity () -> Entity -> NodeContext Entity ()
updateContextWithValue nodeCtx value =
    let
        node =
            nodeCtx.node
    in
        { nodeCtx | node = { node | label = value } }


updateGraphWithList : Graph Entity () -> List Entity -> Graph Entity ()
updateGraphWithList =
    let
        graphUpdater value =
            Maybe.map (\ctx -> updateContextWithValue ctx value)
    in
        List.foldr (\node graph -> Graph.update node.id (graphUpdater node) graph)



-- VIEW


onMouseDown : NodeId -> Attribute Msg
onMouseDown index =
    on "mousedown" (Decode.map (DragStart index) Mouse.position)


linkElement graph edge =
    let
        source =
            Maybe.withDefault (Force.entity 0 "") <| Maybe.map (.node >> .label) <| Graph.get edge.from graph

        target =
            Maybe.withDefault (Force.entity 0 "") <| Maybe.map (.node >> .label) <| Graph.get edge.to graph
    in
        line
            [ strokeWidth "1"
            , stroke "#aaa"
            , x1 (toString source.x)
            , y1 (toString source.y)
            , x2 (toString target.x)
            , y2 (toString target.y)
            ]
            []


nodeElement node =
    circle
        [ r "2.5"
        , fill "#000"
        , stroke "transparent"
        , strokeWidth "7px"
        , onMouseDown node.id
        , cx (toString node.label.x)
        , cy (toString node.label.y)
        ]
        [ Svg.title [] [ text node.label.value ] ]


view : Model -> Html Msg
view model =
    case model of
        Loading ->
            div []
                [ h1 [] [ text "Loading..." ] ]

        Error error ->
            div []
                [ h1 [] [ text "Sorry something went wrong :(" ]
                , pre [] [ text error ]
                ]

        Loaded { graph } ->
            svg [ width (toString screenWidth ++ "px"), height (toString screenHeight ++ "px") ]
                [ g [ class "links" ] <| List.map (linkElement graph) <| Graph.edges graph
                , g [ class "nodes" ] <| List.map nodeElement <| Graph.nodes graph
                ]
