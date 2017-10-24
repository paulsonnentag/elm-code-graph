module Main exposing (..)

import Html exposing (..)
import Http
import Util exposing ((=>))
import Csv
import Array exposing (Array)
import Graph exposing (Edge, Graph, Node, NodeContext, NodeId)
import Html
import Mouse exposing (Position)
import Time exposing (Time)
import Visualization.Force as Force exposing (State)
import List.Extra


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
        , subscriptions = \_ -> Sub.none
        }



-- MODEL


type Model
    = Loading
    | Error String
    | Loaded Explorer


type alias Explorer =
    { nodes : List String
    , edges : List ( Int, Int )

    {--, drag : Maybe Drag
    , graph : Graph Entity ()
    , simulation : Force.State NodeId--}
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
    case msg of
        LoadCsv result ->
            let
                newModel =
                    case result of
                        Ok data ->
                            Loaded (graphFromCsv (Csv.parse data))

                        Err message ->
                            Error (toString message)
            in
                newModel => Cmd.none

        _ ->
            model => Cmd.none


graphFromCsv : Csv.Csv -> Explorer
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
        { nodes = nodes
        , edges = edges
        }


recordToEdge : List String -> Array String -> Maybe ( Int, Int )
recordToEdge nodes record =
    Maybe.map2 (,) (Array.get 0 record) (Array.get 1 record)
        |> Maybe.andThen (\( package, dependency ) -> Maybe.map2 (,) (List.Extra.elemIndex package nodes) (List.Extra.elemIndex dependency nodes))



-- VIEW


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

        Loaded graph ->
            div [] [ text (toString graph) ]
